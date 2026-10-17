"""Bounded, GET-only GitHub delivery reconstruction; reports are observations, not gates."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

from jsonschema import Draft202012Validator

from check_stage_event import SCHEMA, finite_float, reject_constant, unique_object

MARKER = "kami_split.delivery_stage"


def now():
    return datetime.now(timezone.utc).isoformat()


def decode(text):
    return json.loads(text, object_pairs_hook=unique_object,
                      parse_constant=reject_constant, parse_float=finite_float)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


class ReadFailure(Exception):
    """A fixed diagnostic; never contains GitHub stderr or submitted body data."""


class GitHub:
    """Fixed host, repository and read method; no caller-supplied URL execution."""

    def __init__(self, repository):
        self.prefix = f"repos/{repository}/"

    def get(self, endpoint):
        if not endpoint.startswith(self.prefix) or not re.fullmatch(
            r"repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_/?=&.-]+", endpoint
        ):
            raise ReadFailure("invalid_endpoint")
        try:
            result = subprocess.run(
                ["gh", "api", "--hostname", "github.com", "--method", "GET",
                 "-H", "Accept: application/vnd.github+json", endpoint],
                capture_output=True, text=True, timeout=45, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise ReadFailure("api_unavailable") from None
        if result.returncode:
            # Distinguish expiry/missing from transport/auth without leaking stderr.
            code = "missing_or_expired" if re.search(r"HTTP (404|410)", result.stderr) else "api_failed"
            raise ReadFailure(code)
        try:
            return decode(result.stdout)
        except (ValueError, UnicodeError):
            raise ReadFailure("invalid_api_json") from None


class Collector:
    """Own retrieval coverage, source retention and the finite request budget."""

    def __init__(self, repository, adapter, max_pages=100, max_requests=3000):
        self.repository = repository
        self.started_at = now()
        self.root = f"https://github.com/{repository}"
        self.prefix = f"repos/{repository}"
        self.adapter = adapter
        self.max_pages = max_pages
        self.max_requests = max_requests
        self.resources = {}
        self.coverage = []
        self.diagnostics = []
        self.documents = {}
        self.prs = {}
        self.issues = {}
        self.issue_prs = {}
        self.revision_histories = set()
        self.validator = Draft202012Validator(decode(SCHEMA.read_text()))

    def diagnostic(self, code, source, **details):
        self.diagnostics.append({"code": code, "source": source, **details})

    def get(self, path):
        endpoint = f"{self.prefix}/{path}"
        if endpoint in self.resources:
            return self.resources[endpoint]["data"]
        observed = now()
        if len(self.resources) >= self.max_requests:
            self.diagnostic("request_cap", endpoint)
            return None
        try:
            data = self.adapter.get(endpoint)
            if not isinstance(data, (dict, list)) or ("?" not in path and not isinstance(data, dict)):
                raise ReadFailure("invalid_api_shape")
            status = "retrieved"
        except ReadFailure as error:
            data, status = None, str(error)
            self.diagnostic(status, endpoint)
        self.resources[endpoint] = {"observed_at": observed, "status": status, "data": data}
        return data

    def pages(self, path, key=None):
        """Fetch until an empty/short page; 1000-result search-style caps stay explicit."""
        result = []
        complete = False
        for page in range(1, self.max_pages + 1):
            separator = "&" if "?" in path else "?"
            data = self.get(f"{path}{separator}per_page=100&page={page}")
            values = data.get(key) if isinstance(data, dict) and key else data
            if not isinstance(values, list) or any(not isinstance(v, dict) for v in values):
                self.diagnostic("invalid_or_missing_page", path, page=page)
                break
            result.extend(values)
            if key and data.get("total_count", 0) > 1000 and key == "workflow_runs":
                self.diagnostic("github_result_cap", path)
                break
            if len(values) < 100:
                if key and isinstance(data.get("total_count"), int) and len(result) < data["total_count"]:
                    self.diagnostic("reported_count_exceeds_retrieved", path)
                    break
                complete = True
                break
        if not complete:
            self.diagnostic("incomplete_pagination", path)
        if re.fullmatch(r"pulls/\d+/commits", path) and len(result) >= 250:
            complete = False
            self.diagnostic("github_PR_commit_cap", path)
        self.coverage.append({"endpoint": path, "complete": complete, "items": len(result)})
        return result

    def document(self, data, kind):
        if not isinstance(data, dict) or not data.get("html_url"):
            return
        source = data["html_url"]
        body = data.get("body") or ""
        self.documents[source] = {
            "source": source, "id": data.get("id"), "kind": kind,
            "created_at": data.get("created_at"), "updated_at": data.get("updated_at"),
            "observed_at": now(), "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
            "body": body,
        }

    def history(self, number, kind):
        comments = self.pages(f"issues/{number}/comments")
        for item in comments:
            self.document(item, "issue_comment")
        timeline = self.pages(f"issues/{number}/timeline")
        linked = set()
        for item in timeline:
            issue = item.get("source", {}).get("issue", {})
            if "pull_request" in issue:
                match = re.fullmatch(re.escape(self.root) + r"/pull/(\d+)", issue.get("html_url", ""))
                if match:
                    linked.add(int(match[1]))
        if kind == "issue":
            # Direct PR references on a declared issue are delivery candidates;
            # linked background issues are never expanded.
            for doc in [self.issues.get(number) or {}, *comments]:
                linked.update(int(n) for n in re.findall(
                    re.escape(self.root) + r"/pull/(\d+)\b", doc.get("body") or ""))
        return linked

    def pull(self, number):
        if number in self.prs:
            return
        data = self.get(f"pulls/{number}")
        self.prs[number] = data
        if not isinstance(data, dict):
            return
        self.document(data, "pull")
        self.history(number, "pull")
        for item in self.pages(f"pulls/{number}/reviews"):
            self.document(item, "review")
        for item in self.pages(f"pulls/{number}/comments"):
            self.document(item, "review_comment")
        commits = self.pages(f"pulls/{number}/commits")
        shas = {item.get("sha") for item in commits}
        shas.update([data.get("head", {}).get("sha"), data.get("merge_commit_sha")])
        for sha in sorted(s for s in shas if isinstance(s, str) and re.fullmatch(r"[a-f0-9]{40}", s)):
            self.revision_history(sha)

    def revision_history(self, sha):
        """Discover CI even for failed/removed heads with no retained check IDs."""
        if sha in self.revision_histories:
            return
        self.revision_histories.add(sha)
        self.pages(f"commits/{sha}/check-runs?filter=all", "check_runs")
        self.pages(f"commits/{sha}/statuses")
        for run in self.pages(f"actions/runs?head_sha={sha}", "workflow_runs"):
            self.run(run.get("id"))

    def run(self, run_id):
        if not str(run_id).isdigit():
            return None
        data = self.get(f"actions/runs/{run_id}")
        if not isinstance(data, dict):
            return None
        attempts = data.get("run_attempt")
        if not isinstance(attempts, int) or attempts < 1 or attempts > self.max_pages:
            self.diagnostic("attempt_cap_or_invalid", f"actions/runs/{run_id}")
            return data
        for attempt in range(1, attempts + 1):
            self.get(f"actions/runs/{run_id}/attempts/{attempt}")
            self.pages(f"actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
        return data

    def extract(self):
        records = []
        for doc in list(self.documents.values()):
            if doc["updated_at"] and doc["created_at"] and doc["updated_at"] != doc["created_at"]:
                self.diagnostic("edited_source_history_unavailable", doc["source"])
            for position, block in enumerate(re.finditer(r"(?ms)^```[^\n]*\n(.*?)(?:^```\s*$|\Z)", doc["body"])):
                raw = block[1]
                if MARKER in raw and not re.search(r"(?m)^```[ \t]*$", block[0]):
                    self.diagnostic("unclosed_marked_record", doc["source"], block=position)
                    continue
                try:
                    event = decode(raw)
                except ValueError:
                    if MARKER in raw:
                        self.diagnostic("malformed_marked_record", doc["source"], block=position)
                    continue
                if not isinstance(event, dict) or event.get("record_type") != MARKER:
                    continue
                if type(event.get("schema_version")) is not int or event["schema_version"] != 1:
                    self.diagnostic("unsupported_version", doc["source"], block=position)
                    continue
                if not self.validator.is_valid(event) or event["event_id"] in event["supersedes"]:
                    self.diagnostic("invalid_marked_record", doc["source"], block=position)
                    continue
                records.append({"event": event, "source": doc["source"], "block": position,
                                "source_id": doc["id"], "updated_at": doc["updated_at"],
                                "observed_at": doc["observed_at"]})
        return records

    def follow_evidence(self, records):
        """Follow precise same-repo evidence, never recursive background issue bodies."""
        for record in records:
            event = record["event"]
            for source in event["evidence"]["sources"] + event["intervention"]["sources"]:
                if not source.startswith(self.root + "/"):
                    self.diagnostic("external_evidence_not_retrieved", source)
                    continue
                tail = source[len(self.root):]
                comment = re.fullmatch(r"/(?:issues|pull)/\d+#issuecomment-(\d+)", tail)
                review = re.fullmatch(r"/pull/(\d+)#pullrequestreview-(\d+)", tail)
                review_comment = re.fullmatch(r"/pull/\d+#discussion_r(\d+)", tail)
                pull = re.fullmatch(r"/pull/(\d+)", tail)
                run = re.fullmatch(r"/actions/runs/(\d+)(?:/attempts/\d+|/job/\d+)?", tail)
                if comment:
                    self.document(self.get(f"issues/comments/{comment[1]}"), "referenced_comment")
                elif review:
                    self.document(self.get(f"pulls/{review[1]}/reviews/{review[2]}"), "referenced_review")
                elif review_comment:
                    self.document(self.get(f"pulls/comments/{review_comment[1]}"), "referenced_review_comment")
                elif pull:
                    number = int(pull[1])
                    goal = re.fullmatch(re.escape(self.root) + r"/issues/(\d+)", event["goal"])
                    if goal and int(goal[1]) in self.issue_prs:
                        self.issue_prs[int(goal[1])].add(number)
                    self.pull(number)
                elif run:
                    self.run(run[1])
                else:
                    self.diagnostic("evidence_reference_not_expanded", source)

    def observe_check(self, check):
        """Retained assertions and fresh API identities are separate observations."""
        result = {"retained": check, "fresh": {}, "status": "unverified", "limitations": []}
        mismatch = []
        identities = {field: [] for field in ["run_id", "attempt", "job_id", "check_id"]}

        def identity(field, value, origin):
            if value is not None:
                identities[field].append((str(value), origin))

        def run_link(url, origin):
            if not url.startswith((self.root + "/", f"https://api.github.com/repos/{self.repository}/")):
                return None
            query_check = re.search(r"[?&]check_run_id=(\d+)", url)
            if query_check:
                identity("check_id", query_check[1], origin)
            parsed = re.search(
                r"/actions/runs/(\d+)(?:/attempts/(\d+))?(?:/job/(\d+))?/?(?=$|[?#])", url)
            if parsed:
                for field, value in zip(["run_id", "attempt", "job_id"], parsed.groups()):
                    identity(field, value, origin)
            return parsed

        for field in ["run_id", "attempt", "check_id"]:
            identity(field, check[field], "retained")
        for key in ["check_id", "run_id"]:
            if check[key] is not None and not check[key].isdigit():
                mismatch.append(key)
        if not check["source"].startswith(self.root + "/"):
            result["limitations"].append("external_check_source_not_verified")
        source_ids = run_link(check["source"], "source")
        source_attempt = int(source_ids[2]) if source_ids and source_ids[2] else None
        if source_attempt is not None and check["attempt"] is not None and source_attempt != check["attempt"]:
            mismatch.append("source_attempt")
        source_check = re.search(r"[?&]check_run_id=(\d+)", check["source"])
        if source_check:
            identity("check_id", source_check[1], "source")
        if source_check and check["check_id"] and source_check[1] != check["check_id"]:
            mismatch.append("source_check_id")
        if source_ids and check["run_id"] and source_ids[1] != check["run_id"]:
            mismatch.append("source_run_id")
        check_identity = check["check_id"] or (source_check[1] if source_check else None)
        details = None
        if check_identity and check_identity.isdigit():
            fresh = self.get(f"check-runs/{check_identity}")
            result["fresh"]["check"] = fresh
            if fresh:
                identity("check_id", fresh.get("id"), "fresh_check")
                for field, remote in [("check_id", "id"), ("name", "name"), ("head", "head_sha"), ("conclusion", "conclusion")]:
                    if check[field] is not None and str(check[field]) != str(fresh.get(remote)):
                        mismatch.append(field)
                details = run_link(fresh.get("details_url") or "", "fresh_check")
                run_link(fresh.get("html_url") or "", "fresh_check")
                if details and check["run_id"] and details[1] != check["run_id"]:
                    mismatch.append("check_run_relation")
        if check["run_id"] and check["run_id"].isdigit():
            run = self.run(check["run_id"])
            attempt = check["attempt"] if check["attempt"] is not None else source_attempt
            fresh = self.get(f"actions/runs/{check['run_id']}/attempts/{attempt}") if attempt else run
            result["fresh"]["run_attempt"] = fresh
            if fresh:
                identity("run_id", fresh.get("id"), "fresh_run")
                identity("attempt", fresh.get("run_attempt"), "fresh_run")
                if source_attempt is not None and source_attempt != fresh.get("run_attempt"):
                    mismatch.append("source_attempt")
                for field, remote in [("run_id", "id"), ("head", "head_sha"), ("attempt", "run_attempt")]:
                    if check[field] is not None and str(check[field]) != str(fresh.get(remote)):
                        mismatch.append(field)
                workflow = check["workflow"]
                if workflow is not None:
                    path = re.search(r"\.github/workflows/[A-Za-z0-9_.-]+", workflow)
                    workflow_identity = re.search(r"(?:workflow\s+ID\s*|^)(\d+)(?=:|\))", workflow)
                    if path:
                        if path[0] != fresh.get("path"):
                            mismatch.append("workflow_path")
                        if workflow_identity and workflow_identity[1] != str(fresh.get("workflow_id")):
                            mismatch.append("workflow_id")
                    elif workflow != fresh.get("name"):
                        result["limitations"].append("workflow_description_not_machine_comparable")
                # A job conclusion need not equal the aggregate run conclusion.
                if not check_identity and not (source_ids and source_ids[3]) and check["conclusion"] != fresh.get("conclusion"):
                    mismatch.append("conclusion")
        if check["workflow_revision"]:
            result["limitations"].append("workflow_revision_not_attested_by_run_API")
        if source_ids and source_ids[3]:
            job = self.get(f"actions/jobs/{source_ids[3]}")
            result["fresh"]["source_job"] = job
            if job:
                run_link(job.get("html_url") or "", "fresh_job")
                run_link(job.get("run_url") or "", "fresh_job")
                for field, remote in [("job_id", "id"), ("run_id", "run_id"), ("attempt", "run_attempt")]:
                    identity(field, job.get(remote), "fresh_job")
                for field, remote in [("run_id", "run_id"), ("attempt", "run_attempt"),
                                      ("head", "head_sha"), ("name", "name"), ("conclusion", "conclusion")]:
                    if check[field] is not None and str(check[field]) != str(job.get(remote)):
                        mismatch.append("job_" + field)
                job_check = re.fullmatch(
                    re.escape(f"https://api.github.com/repos/{self.repository}/check-runs/") + r"(\d+)",
                    job.get("check_run_url") or "")
                if job_check:
                    identity("check_id", job_check[1], "fresh_job")
                if job_check and check["check_id"] and job_check[1] != check["check_id"]:
                    mismatch.append("job_check_relation")
                if check_identity and not job_check and not (details and details[3]):
                    result["limitations"].append("job_check_relation_unavailable")
        for field, claims in identities.items():
            if len({value for value, _origin in claims}) > 1:
                mismatch.append("identity_" + field)
            if any(origin == "source" for _value, origin in claims) and not any(
                origin.startswith("fresh_") for _value, origin in claims
            ):
                result["limitations"].append("source_identity_not_established")
        if mismatch:
            result["status"] = "inconsistent"
            result["mismatches"] = sorted(set(mismatch))
        elif any(l in result["limitations"] for l in ["workflow_description_not_machine_comparable",
                                                      "external_check_source_not_verified", "job_check_relation_unavailable",
                                                      "source_identity_not_established"]):
            pass
        elif result["fresh"] and all(result["fresh"].values()) and (
            check_identity is not None or (source_ids and source_ids[3]) or
            (check["run_id"] is not None and check["attempt"] is not None)
        ):
            result["status"] = "observed_fields_consistent"
        else:
            result["limitations"].append("missing_identity_or_unavailable_fresh_source")
        return result

    def collect(self, issue_numbers, previous=None):
        linked = set()
        for number in issue_numbers:
            data = self.get(f"issues/{number}")
            self.issues[number] = data
            self.document(data, "issue")
            self.issue_prs[number] = self.history(number, "issue")
            linked.update(self.issue_prs[number])
        for number in sorted(linked):
            self.pull(number)
        # Bounded closure over explicit structured evidence only, under the same
        # request budget. No links in fetched background prose trigger traversal.
        followed = set()
        while True:
            records = self.extract_without_diagnostics()
            pending = [r for r in records if (r["source"], r["block"]) not in followed]
            if not pending:
                break
            followed.update((r["source"], r["block"]) for r in pending)
            self.follow_evidence(pending)
        records = self.extract()
        for record in records:
            revision = record["event"]["revision"]
            if revision["repository"] != self.root:
                self.diagnostic("record_revision_repository_not_retrieved", record["source"])
                continue
            for field in ["head", "tested"]:
                if revision[field] is None:
                    self.diagnostic("record_revision_unknown", record["source"], field=field)
                else:
                    self.revision_history(revision[field])
        resolved = reconcile(records)
        self.diagnostics.extend(resolved["diagnostics"])
        checks = [{"event_id": r["event"]["event_id"], "source": r["source"],
                   **self.observe_check(check)} for r in records for check in r["event"]["evidence"]["checks"]]
        if previous is not None:
            for source, old in previous.get("documents", {}).items():
                current = self.documents.get(source)
                if current is None:
                    self.diagnostic("previous_source_not_observed", source)
                elif old.get("body_sha256") != current["body_sha256"]:
                    self.diagnostic("source_changed_since_snapshot", source)
        retrieval_complete = all(c["complete"] for c in self.coverage) and all(
            r["status"] == "retrieved" for r in self.resources.values()) and not any(
                d["code"] in ["request_cap", "attempt_cap_or_invalid"] for d in self.diagnostics)
        record_coverage_complete = not any(d["code"] in [
            "malformed_marked_record", "unclosed_marked_record", "invalid_marked_record",
            "unsupported_version", "conflicting_event_id", "dangling_supersession",
            "cyclic_supersession", "conflicting_supersession",
        ] for d in self.diagnostics)
        goals = [score_goal(self.root + f"/issues/{n}", self.issues[n], resolved,
                            {p: self.prs.get(p) for p in self.issue_prs[n]},
                            checks, retrieval_complete and record_coverage_complete) for n in issue_numbers]
        return {
            "report_version": 1, "repository": self.repository, "started_at": self.started_at, "observed_at": now(),
            "declared_issues": issue_numbers, "denominator": len(issue_numbers),
            "retrieval_complete": retrieval_complete, "record_coverage_complete": record_coverage_complete,
            "evidence_coverage_complete": retrieval_complete and record_coverage_complete and not any(d["code"] in [
                "external_evidence_not_retrieved", "evidence_reference_not_expanded",
                "record_revision_repository_not_retrieved", "record_revision_unknown",
            ] for d in self.diagnostics) and all(c["status"] == "observed_fields_consistent" for c in checks),
            "coverage": self.coverage,
            "diagnostics": self.diagnostics, "goals": goals, "reconciliation": resolved,
            "check_observations": checks, "documents": self.documents, "resources": self.resources,
            "limits": {"max_pages_per_endpoint": self.max_pages, "max_requests": self.max_requests},
            "limitations": ["Declared cohort only; not a repository census or independent acceptance.",
                            "Deleted or earlier edited content is unavailable without a prior snapshot.",
                            "GitHub observations are not authenticated execution provenance.",
                            "Cost, active effort and savings are unknown; stage durations are not summed.",
                            "Missing records and scoped none_observed never establish whole-goal zero."],
        }

    def extract_without_diagnostics(self):
        offset = len(self.diagnostics)
        result = self.extract()
        del self.diagnostics[offset:]
        return result


def reconcile(records):
    """Resolve whole-event replacements; quarantine ambiguous graph components."""
    groups = {}
    diagnostics = []
    for record in records:
        groups.setdefault(record["event"]["event_id"], []).append(record)
    bad = set()
    events = {}
    for identity, copies in groups.items():
        payloads = {canonical(r["event"]) for r in copies}
        if len(payloads) != 1:
            bad.add(identity)
            diagnostics.append({"code": "conflicting_event_id", "source": identity})
        else:
            events[identity] = copies[0]["event"]
            if len(copies) > 1:
                diagnostics.append({"code": "duplicate_publication", "source": identity})
    adjacent = {identity: set() for identity in groups}
    successors = {}
    for identity, copies in groups.items():
        for prior in {p for r in copies for p in r["event"]["supersedes"]}:
            if prior not in groups:
                bad.add(identity)
                diagnostics.append({"code": "dangling_supersession", "source": identity, "target": prior})
                continue
            adjacent[identity].add(prior)
            adjacent[prior].add(identity)
            successors.setdefault(prior, set()).add(identity)
    for prior, replacements in successors.items():
        if len(replacements) > 1:
            bad.add(prior)
            diagnostics.append({"code": "conflicting_supersession", "source": prior})
    # Iterative DFS keeps long correction chains inside the request bound rather
    # than Python's smaller recursion limit.
    visiting, visited = set(), set()
    for identity in groups:
        stack = [(identity, False)]
        while stack:
            node, leaving = stack.pop()
            if leaving:
                visiting.discard(node)
                visited.add(node)
            elif node in visiting:
                bad.add(node)
                diagnostics.append({"code": "cyclic_supersession", "source": node})
            elif node not in visited:
                visiting.add(node)
                stack.append((node, True))
                stack.extend((prior, False) for prior in events.get(node, {}).get("supersedes", [])
                             if prior in groups)
    queue = list(bad)
    while queue:
        for neighbor in adjacent[queue.pop()]:
            if neighbor not in bad:
                bad.add(neighbor)
                queue.append(neighbor)
    active = [r for identity, copies in groups.items() if identity not in bad and identity not in successors
              for r in copies[:1]]
    return {"active": active, "publications": records, "quarantined_ids": sorted(bad),
            "superseded_ids": sorted(set(successors) - bad), "diagnostics": diagnostics}


def score_goal(goal, issue, resolved, prs, checks, complete):
    records = [r for r in resolved["active"] if r["event"]["goal"] == goal]
    events = [r["event"] for r in records]
    attempts = sorted({e["attempt_id"] for e in events})
    declarations = {}
    references = set()
    for event in events:
        cycle = event.get("correction_cycle")
        if cycle:
            references.add(cycle["id"])
            if "cause" in cycle:
                declarations.setdefault(cycle["id"], []).append({
                    "attempt_id": event["attempt_id"], "source_stage": cycle["source_stage"], "cause": cycle["cause"]})
    cycle_conflicts = sorted(k for k, values in declarations.items() if len({canonical(v) for v in values}) > 1)
    acceptance = [r for r in records if r["event"]["stage"] == "goal" and r["event"]["outcome"] == "passed"]
    status = "not_recorded"
    acceptance_limits = []
    if acceptance:
        status = "unverified"
        if len(acceptance) != 1:
            acceptance_limits.append("multiple_unsuperseded_goal_acceptance_records")
        elif not issue or issue.get("state") != "closed":
            status = "inconsistent"
            acceptance_limits.append("live_issue_not_closed")
        else:
            event = acceptance[0]["event"]
            revision = event["revision"]
            if revision["repository"] != goal.split("/issues/")[0]:
                status = "inconsistent"
                acceptance_limits.append("acceptance_repository_mismatch")
            elif revision["head"] != revision["tested"]:
                status = "inconsistent"
                acceptance_limits.append("acceptance_tested_revision_differs_from_head")
            elif not revision["head"] or not revision["tested"]:
                acceptance_limits.append("acceptance_revision_unknown")
            elif not any(p and p.get("head", {}).get("sha") == revision["head"] and p.get("merged_at") for p in prs.values()):
                status = "inconsistent"
                acceptance_limits.append("acceptance_head_not_a_retrieved_merged_PR_head")
            elif any(p and p.get("state") == "open" for p in prs.values()):
                acceptance_limits.append("linked_PR_still_open")
            elif not complete or resolved["quarantined_ids"]:
                acceptance_limits.append("incomplete_or_ambiguous_history")
            elif any(c["status"] != "observed_fields_consistent" for c in checks if c["event_id"] == event["event_id"]):
                acceptance_limits.append("acceptance_checks_not_freshly_consistent")
            else:
                status = "recorded_with_live_consistency"
    states = {e["outcome"] for e in events}
    state = "not_started_or_unrecorded" if not events else "ongoing"
    if status == "recorded_with_live_consistency":
        state = "recorded_accepted"
    elif "blocked" in states:
        state = "blocked_observed"
    elif "failed" in states:
        state = "failure_observed"
    elif "cancelled" in states:
        state = "cancellation_observed"
    return {"goal": goal, "live_issue_state": issue.get("state") if issue else None,
            "state": state, "attempts": attempts,
            "attempt_outcomes": {a: [{"event_id": e["event_id"], "stage": e["stage"], "outcome": e["outcome"]}
                                      for e in events if e["attempt_id"] == a] for a in attempts},
            "acceptance": status, "acceptance_sources": [r["source"] for r in acceptance],
            "acceptance_limitations": acceptance_limits,
            "declared_correction_cycles": declarations,
            "distinct_declared_cycle_count": len(declarations), "cycle_conflicts": cycle_conflicts,
            "undeclared_cycle_references": sorted(references - declarations.keys()),
            "whole_goal_cycle_total": None,
            "record_corrections": len({r["event"]["event_id"] for r in resolved["publications"]
                                       if r["event"]["goal"] == goal and r["event"]["supersedes"]}),
            "interventions": [{"event_id": e["event_id"], **e["intervention"]} for e in events],
            "whole_goal_intervention_total": None,
            "stage_timings": [{"event_id": e["event_id"], "stage": e["stage"], **e["timing"]} for e in events],
            "delivery_elapsed_seconds": None, "active_effort_seconds": None, "cost": None,
            "sources": [{"event_id": r["event"]["event_id"], "source": r["source"]} for r in records]}


def main(args=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--issues", required=True, nargs="+", type=int)
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--max-requests", type=int, default=3000)
    parser.add_argument("--previous", type=Path, help="Optional prior report for source-change comparison")
    options = parser.parse_args(args)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", options.repo) or any(n < 1 for n in options.issues) or not 1 <= options.max_pages <= 100 or not 1 <= options.max_requests <= 10000 or len(options.issues) > 100:
        parser.error("Use a repository, 1–100 positive issue IDs and bounded positive limits")
    try:
        previous = decode(options.previous.read_text()) if options.previous else None
        if previous is not None and (not isinstance(previous, dict) or
                                     not isinstance(previous.get("documents"), dict) or
                                     any(not isinstance(v, dict) for v in previous["documents"].values())):
            raise ValueError("Invalid previous snapshot")
        report = Collector(options.repo, GitHub(options.repo), options.max_pages, options.max_requests).collect(
            sorted(set(options.issues)), previous)
    except (OSError, ValueError, RecursionError):
        print("Collector could not read input or reconstruct bounded history; inspect local inputs.", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    return 0 if report["retrieval_complete"] and report["record_coverage_complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
