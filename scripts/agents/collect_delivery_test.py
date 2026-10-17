"""Synthetic histories exercise retrieval and conservative reconstruction, never live ledgers."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from collect_delivery import Collector, GitHub, ReadFailure, reconcile, score_goal

ROOT = "https://github.com/example/project"
PREFIX = "repos/example/project/"
EXAMPLE = Path(__file__).resolve().parents[2] / "docs/agents/records/stage-event.example.json"


def event(identity="event-a", **changes):
    value = json.loads(EXAMPLE.read_text())
    value.update(event_id=identity, goal=ROOT + "/issues/1", attempt_id="attempt-1", supersedes=[])
    value["evidence"] = {"sources": [], "checks": []}
    value.update(changes)
    return value


def publication(value, number=1):
    return {"event": value, "source": ROOT + f"/issues/1#issuecomment-{number}", "block": 0}


def comment(number, body="", **changes):
    return {"id": number, "html_url": ROOT + f"/issues/1#issuecomment-{number}", "body": body,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z", **changes}


def fenced(value):
    return "```json\n" + json.dumps(value) + "\n```\n"


class Fake:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, endpoint):
        self.calls.append(endpoint)
        value = self.routes.get(endpoint.removeprefix(PREFIX), ReadFailure("missing_or_expired"))
        if isinstance(value, ReadFailure):
            raise value
        return deepcopy(value)


def base_routes():
    return {"issues/1": {"id": 1, "html_url": ROOT + "/issues/1", "state": "open", "body": ""},
            "issues/2": {"id": 2, "html_url": ROOT + "/issues/2", "state": "open", "body": ""},
            "issues/1/comments?per_page=100&page=1": [], "issues/1/timeline?per_page=100&page=1": [],
            "issues/2/comments?per_page=100&page=1": [], "issues/2/timeline?per_page=100&page=1": [],
            "commits/" + "2" * 40 + "/check-runs?filter=all&per_page=100&page=1": {"check_runs": []},
            "commits/" + "2" * 40 + "/statuses?per_page=100&page=1": [],
            "actions/runs?head_sha=" + "2" * 40 + "&per_page=100&page=1": {"workflow_runs": []}}


def job_evidence():
    """A successful Verify job can belong to a failed aggregate workflow run."""
    check = json.loads(EXAMPLE.read_text())["evidence"]["checks"][0]
    check.update(check_id="7", run_id="8", attempt=1, source=ROOT + "/actions/runs/8/attempts/1/job/9",
                 workflow="CI", workflow_revision=None, head="a" * 40, conclusion="success")
    run = {"id": 8, "run_attempt": 1, "head_sha": check["head"], "name": "CI", "conclusion": "failure"}
    routes = {"check-runs/7": {"id": 7, "name": check["name"], "head_sha": check["head"],
                                "conclusion": "success", "details_url": ROOT + "/actions/runs/8/job/9"},
              "actions/runs/8": run, "actions/runs/8/attempts/1": run,
              "actions/runs/8/attempts/1/jobs?per_page=100&page=1": {"jobs": []},
              "actions/jobs/9": {"id": 9, "run_id": 8, "run_attempt": 1, "head_sha": check["head"],
                                  "name": check["name"], "conclusion": "success",
                                  "check_run_url": "https://api.github.com/repos/example/project/check-runs/7"}}
    return check, routes


class RetrievalTests(unittest.TestCase):
    def test_multi_page_comments_ongoing_denominator_and_precise_cross_link(self):
        routes = base_routes()
        record = event(outcome="ongoing")
        record["evidence"]["sources"] = [ROOT + "/issues/9#issuecomment-901", ROOT + "/issues/99"]
        routes["issues/1/comments?per_page=100&page=1"] = [comment(i) for i in range(100)]
        routes["issues/1/comments?per_page=100&page=2"] = [comment(101, fenced(record))]
        correction = event("replacement", supersedes=["event-a"], outcome="blocked")
        routes["issues/comments/901"] = comment(901, fenced(correction))
        adapter = Fake(routes)
        report = Collector("example/project", adapter).collect([1, 2])
        self.assertTrue(report["retrieval_complete"])
        self.assertEqual(report["denominator"], 2)
        self.assertEqual(report["goals"][0]["state"], "blocked_observed")
        self.assertEqual(report["goals"][1]["state"], "not_started_or_unrecorded")
        self.assertEqual(report["reconciliation"]["superseded_ids"], ["event-a"])
        self.assertNotIn(PREFIX + "issues/99", adapter.calls)
        self.assertEqual(report["goals"][0]["whole_goal_intervention_total"], None)
        self.assertEqual(report["goals"][0]["active_effort_seconds"], None)

    def test_page_failure_caps_and_missing_issue_remain_incomplete(self):
        routes = base_routes()
        routes["issues/1/comments?per_page=100&page=1"] = [comment(i) for i in range(100)]
        for kwargs in [{}, {"max_pages": 1}, {"max_requests": 1}]:
            with self.subTest(kwargs=kwargs):
                report = Collector("example/project", Fake(routes), **kwargs).collect([1, 3])
                self.assertFalse(report["retrieval_complete"])
                self.assertEqual(report["denominator"], 2)
                self.assertTrue(report["diagnostics"])

    def test_runs_retrieve_all_attempts_jobs_and_all_commit_check_pages(self):
        routes = base_routes()
        sha = "a" * 40
        routes["issues/1/timeline?per_page=100&page=1"] = [{"source": {"issue": {
            "html_url": ROOT + "/pull/3", "pull_request": {}}}}]
        routes.update({"pulls/3": {"id": 3, "html_url": ROOT + "/pull/3", "body": "",
                                    "head": {"sha": sha}, "state": "closed", "merged_at": "date"},
                       "issues/3/comments?per_page=100&page=1": [], "issues/3/timeline?per_page=100&page=1": [],
                       "pulls/3/reviews?per_page=100&page=1": [], "pulls/3/comments?per_page=100&page=1": [],
                       "pulls/3/commits?per_page=100&page=1": [{"sha": sha}],
                       f"commits/{sha}/check-runs?filter=all&per_page=100&page=1": {"check_runs": [{"id": i} for i in range(100)]},
                       f"commits/{sha}/check-runs?filter=all&per_page=100&page=2": {"check_runs": [{"id": 101}]},
                       f"commits/{sha}/statuses?per_page=100&page=1": [],
                       f"actions/runs?head_sha={sha}&per_page=100&page=1": {"total_count": 1, "workflow_runs": [{"id": 7}]},
                       "actions/runs/7": {"id": 7, "run_attempt": 2}})
        for attempt in [1, 2]:
            routes[f"actions/runs/7/attempts/{attempt}"] = {"id": 7, "run_attempt": attempt}
            routes[f"actions/runs/7/attempts/{attempt}/jobs?per_page=100&page=1"] = {"jobs": [{"id": attempt}]}
        adapter = Fake(routes)
        report = Collector("example/project", adapter).collect([1])
        self.assertTrue(report["retrieval_complete"])
        self.assertIn(PREFIX + "actions/runs/7/attempts/1/jobs?per_page=100&page=1", adapter.calls)
        self.assertIn(PREFIX + "actions/runs/7/attempts/2/jobs?per_page=100&page=1", adapter.calls)
        self.assertTrue(any(c["items"] == 101 for c in report["coverage"]))

    def test_malformed_unsupported_edited_and_changed_sources(self):
        routes = base_routes()
        body = '```json\n{"record_type":"kami_split.delivery_stage", bad}\n```\n'
        body += fenced(event("v2", schema_version=2))
        body += fenced(event("bad", stage="invented"))
        routes["issues/1/comments?per_page=100&page=1"] = [comment(1, body, updated_at="later")]
        previous = {"documents": {ROOT + "/issues/1#issuecomment-1": {"body_sha256": "old"}, "deleted": {}}}
        report = Collector("example/project", Fake(routes)).collect([1], previous)
        codes = {d["code"] for d in report["diagnostics"]}
        self.assertTrue({"malformed_marked_record", "unsupported_version", "invalid_marked_record",
                         "edited_source_history_unavailable", "source_changed_since_snapshot",
                         "previous_source_not_observed"} <= codes)

    def test_malformed_api_shapes_produce_bounded_incomplete_report(self):
        routes = base_routes()
        routes["issues/1"] = []
        routes["issues/1/comments?per_page=100&page=1"] = ["unexpected scalar"]
        report = Collector("example/project", Fake(routes)).collect([1])
        self.assertFalse(report["retrieval_complete"])
        self.assertIn("invalid_api_shape", {d["code"] for d in report["diagnostics"]})

    def test_failed_or_capped_comment_history_cannot_establish_evidence_coverage(self):
        routes = base_routes()
        del routes["issues/1/comments?per_page=100&page=1"]
        report = Collector("example/project", Fake(routes)).collect([1])
        self.assertFalse(report["retrieval_complete"])
        self.assertFalse(report["evidence_coverage_complete"])
        routes["issues/1/comments?per_page=100&page=1"] = [comment(i) for i in range(100)]
        report = Collector("example/project", Fake(routes), max_pages=1).collect([1])
        self.assertFalse(report["evidence_coverage_complete"])

    def test_historical_record_revisions_discover_paginated_ci_without_check_ids(self):
        routes = base_routes()
        head, tested = "b" * 40, "c" * 40
        record = event(outcome="failed")
        record["revision"].update(head=head, tested=tested)
        routes["issues/1/comments?per_page=100&page=1"] = [comment(1, fenced(record))]
        for sha in [head, tested]:
            routes[f"commits/{sha}/check-runs?filter=all&per_page=100&page=1"] = {"check_runs": []}
            routes[f"commits/{sha}/statuses?per_page=100&page=1"] = []
            routes[f"actions/runs?head_sha={sha}&per_page=100&page=1"] = {"workflow_runs": []}
        routes[f"commits/{head}/check-runs?filter=all&per_page=100&page=1"] = {"check_runs": [{"id": i} for i in range(100)]}
        routes[f"commits/{head}/check-runs?filter=all&per_page=100&page=2"] = {"check_runs": [{"id": 101}]}
        routes[f"actions/runs?head_sha={head}&per_page=100&page=1"] = {"workflow_runs": [{"id": 8}]}
        routes["actions/runs/8"] = {"id": 8, "run_attempt": 2}
        for attempt in [1, 2]:
            routes[f"actions/runs/8/attempts/{attempt}"] = {"id": 8, "run_attempt": attempt}
            routes[f"actions/runs/8/attempts/{attempt}/jobs?per_page=100&page=1"] = {"jobs": []}
        adapter = Fake(routes)
        report = Collector("example/project", adapter).collect([1])
        self.assertTrue(report["retrieval_complete"])
        self.assertTrue(report["evidence_coverage_complete"])
        self.assertIn(PREFIX + f"commits/{head}/check-runs?filter=all&per_page=100&page=2", adapter.calls)
        self.assertIn(PREFIX + f"commits/{tested}/statuses?per_page=100&page=1", adapter.calls)
        self.assertIn(PREFIX + "actions/runs/8/attempts/1/jobs?per_page=100&page=1", adapter.calls)
        del routes[f"commits/{tested}/statuses?per_page=100&page=1"]
        failed = Collector("example/project", Fake(routes)).collect([1])
        self.assertFalse(failed["retrieval_complete"])
        self.assertFalse(failed["evidence_coverage_complete"])

    def test_source_attempt_is_reconciled_with_retained_and_live_attempts(self):
        check = json.loads(EXAMPLE.read_text())["evidence"]["checks"][0]
        check.update(check_id="7", run_id="8", attempt=2, source=ROOT + "/actions/runs/8/attempts/1", workflow="CI")
        fresh = {"id": 8, "run_attempt": 2, "head_sha": check["head"], "name": "CI"}
        routes = {"check-runs/7": {"id": 7, "name": check["name"], "head_sha": check["head"], "conclusion": check["conclusion"],
                                    "details_url": ROOT + "/actions/runs/8/attempts/1"},
                  "actions/runs/8": fresh, "actions/runs/8/attempts/1": {**fresh, "run_attempt": 1},
                  "actions/runs/8/attempts/2": fresh,
                  "actions/runs/8/attempts/1/jobs?per_page=100&page=1": {"jobs": []},
                  "actions/runs/8/attempts/2/jobs?per_page=100&page=1": {"jobs": []}}
        for suffix in ["", "/", "?view=logs", "#summary"]:
            check["source"] = ROOT + "/actions/runs/8/attempts/1" + suffix
            observed = Collector("example/project", Fake(routes)).observe_check(check)
            self.assertEqual(observed["status"], "inconsistent")
            self.assertIn("source_attempt", observed["mismatches"])
        check["attempt"] = None
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertEqual(observed["status"], "observed_fields_consistent")
        self.assertEqual(observed["fresh"]["run_attempt"]["run_attempt"], 1)
        del routes["actions/runs/8/attempts/1"]
        self.assertEqual(Collector("example/project", Fake(routes)).observe_check(check)["status"], "unverified")

    def test_retained_check_does_not_become_fresh_after_expiry_or_wrong_id(self):
        collector = Collector("example/project", Fake({}))
        check = json.loads(EXAMPLE.read_text())["evidence"]["checks"][0]
        check.update(check_id="7", run_id="8", source=ROOT + "/actions/runs/9/job/10")
        observation = collector.observe_check(check)
        self.assertEqual(observation["retained"], check)
        self.assertEqual(observation["status"], "inconsistent")
        self.assertIn("source_run_id", observation["mismatches"])
        check.update(source=ROOT + "/actions/runs/8", check_id=None)
        self.assertEqual(collector.observe_check(check)["status"], "unverified")

    def test_unclosed_marker_and_inconsistent_counts_are_not_silently_accepted(self):
        routes = base_routes()
        routes["issues/1/comments?per_page=100&page=1"] = [comment(1, "```json\n" + json.dumps(event()))]
        report = Collector("example/project", Fake(routes)).collect([1])
        self.assertFalse(report["record_coverage_complete"])
        self.assertEqual(report["reconciliation"]["active"], [])
        collector = Collector("example/project", Fake({"actions/runs?per_page=100&page=1": {
            "total_count": 2000, "workflow_runs": [{"id": 1}]}}))
        collector.pages("actions/runs", "workflow_runs")
        self.assertFalse(collector.coverage[0]["complete"])
        self.assertIn("github_result_cap", {d["code"] for d in collector.diagnostics})

    def test_retained_workflow_descriptions_compare_path_and_explicit_identity(self):
        check = json.loads(EXAMPLE.read_text())["evidence"]["checks"][0]
        check.update(check_id="7", run_id="8", attempt=1, source=ROOT + "/actions/runs/8")
        fresh = {"id": 8, "run_attempt": 1, "head_sha": check["head"], "name": "CI",
                 "path": ".github/workflows/ci.yml", "workflow_id": 42}
        routes = {"check-runs/7": {"id": 7, "name": check["name"], "head_sha": check["head"],
                                   "conclusion": check["conclusion"],
                                    "details_url": ROOT + "/actions/runs/8/attempts/1"},
                  "actions/runs/8": fresh, "actions/runs/8/attempts/1": fresh,
                  "actions/runs/8/attempts/1/jobs?per_page=100&page=1": {"jobs": []}}
        for description in [".github/workflows/ci.yml (workflow ID 42)",
                            ".github/workflows/ci.yml (workflow ID42)", "42: .github/workflows/ci.yml"]:
            check["workflow"] = description
            observation = Collector("example/project", Fake(routes)).observe_check(check)
            self.assertEqual(observation["status"], "observed_fields_consistent")
        check["workflow"] = ".github/workflows/ci.yml (workflow ID 999)"
        observation = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertIn("workflow_id", observation["mismatches"])
        check["workflow"] = "free-form description"
        self.assertEqual(Collector("example/project", Fake(routes)).observe_check(check)["status"], "unverified")

    def test_source_job_identity_is_checked_independently_of_check_run_id(self):
        check = json.loads(EXAMPLE.read_text())["evidence"]["checks"][0]
        check.update(check_id="7", run_id="8", attempt=1, source=ROOT + "/actions/runs/8/job/9", workflow="CI")
        fresh = {"id": 8, "run_attempt": 1, "head_sha": check["head"], "name": "CI"}
        routes = {"check-runs/7": {"id": 7, "name": check["name"], "head_sha": check["head"],
                                   "conclusion": check["conclusion"]},
                  "actions/runs/8": fresh, "actions/runs/8/attempts/1": fresh,
                  "actions/runs/8/attempts/1/jobs?per_page=100&page=1": {"jobs": []},
                  "actions/jobs/9": {"id": 9, "run_id": 8, "run_attempt": 1, "head_sha": check["head"],
                                     "name": check["name"], "conclusion": check["conclusion"],
                                     "check_run_url": "https://api.github.com/repos/example/project/check-runs/7"}}
        collector = Collector("example/project", Fake(routes))
        self.assertEqual(collector.observe_check(check)["status"], "observed_fields_consistent")
        routes["actions/jobs/9"]["check_run_url"] = "https://api.github.com/repos/example/project/check-runs/77"
        self.assertIn("job_check_relation", Collector("example/project", Fake(routes)).observe_check(check)["mismatches"])

    def test_nullable_retained_ids_do_not_hide_conflicting_source_and_live_identities(self):
        for field, value, conflict in [("run_id", "999", "identity_run_id"),
                                       ("attempt", 2, "identity_attempt"),
                                       ("job_id", "99", "identity_job_id")]:
            with self.subTest(field=field):
                check, routes = job_evidence()
                check.update(run_id=None, attempt=None, workflow=None)
                if field == "run_id":
                    check["source"] = ROOT + "/actions/runs/999/attempts/1/job/9"
                elif field == "attempt":
                    check["source"] = ROOT + "/actions/runs/8/attempts/2/job/9"
                else:
                    routes["check-runs/7"]["details_url"] = ROOT + "/actions/runs/8/job/99"
                observed = Collector("example/project", Fake(routes)).observe_check(check)
                self.assertEqual(observed["status"], "inconsistent")
                self.assertIn(conflict, observed["mismatches"])
        check, routes = job_evidence()
        check.update(run_id=None, attempt=None, workflow=None)
        self.assertEqual(Collector("example/project", Fake(routes)).observe_check(check)["status"], "observed_fields_consistent")
        del routes["actions/jobs/9"]["run_attempt"]
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertEqual(observed["status"], "unverified")
        self.assertIn("subject_attempt_relation_unavailable", observed["limitations"])

    def test_source_check_query_is_reconciled_when_retained_check_id_is_unknown(self):
        check, routes = job_evidence()
        check.update(check_id=None, run_id=None, attempt=None, workflow=None,
                     source=ROOT + "/pull/3/checks?check_run_id=7")
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertEqual(observed["status"], "observed_fields_consistent")
        routes["check-runs/7"]["id"] = 77
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertEqual(observed["status"], "inconsistent")
        self.assertIn("identity_check_id", observed["mismatches"])
        check, routes = job_evidence()
        check.update(check_id=None, source=ROOT + "/actions/runs/8/attempts/1/job/9?check_run_id=7")
        routes["actions/jobs/9"]["check_run_url"] = "https://api.github.com/repos/example/project/check-runs/77"
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertIn("identity_check_id", observed["mismatches"])
        check, routes = job_evidence()
        check.update(run_id=None, attempt=None, workflow=None)
        routes["check-runs/7"]["details_url"] = ROOT + "/pull/3/checks?check_run_id=77"
        self.assertIn("identity_check_id", Collector("example/project", Fake(routes)).observe_check(check)["mismatches"])

    def test_job_and_run_conclusions_use_their_own_subject_with_unknown_check_id(self):
        check, routes = job_evidence()
        check["check_id"] = None
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertEqual(observed["status"], "observed_fields_consistent")
        for field, value in [("conclusion", "failure"), ("run_id", 999), ("run_attempt", 2)]:
            with self.subTest(field=field):
                changed = deepcopy(routes)
                changed["actions/jobs/9"][field] = value
                self.assertEqual(Collector("example/project", Fake(changed)).observe_check(check)["status"], "inconsistent")
        check.update(run_id=None, attempt=None, workflow=None)
        self.assertEqual(Collector("example/project", Fake(routes)).observe_check(check)["status"], "observed_fields_consistent")
        check.update(run_id="8", attempt=1, source=ROOT + "/actions/runs/8/attempts/1", name="CI")
        observed = Collector("example/project", Fake(routes)).observe_check(check)
        self.assertEqual(observed["status"], "inconsistent")
        self.assertIn("conclusion", observed["mismatches"])
        check["conclusion"] = "failure"
        self.assertEqual(Collector("example/project", Fake(routes)).observe_check(check)["status"], "observed_fields_consistent")

    def test_adapter_only_uses_fixed_host_get_and_never_echoes_stderr(self):
        with patch("collect_delivery.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, "{}", "")
            GitHub("example/project").get(PREFIX + "issues/1")
            command = run.call_args.args[0]
            self.assertIn("GET", command)
            self.assertIn("github.com", command)
            with self.assertRaises(ReadFailure):
                GitHub("example/project").get("https://attacker.test")
            run.return_value = subprocess.CompletedProcess([], 1, "", "private token HTTP 404")
            with self.assertRaisesRegex(ReadFailure, "^missing_or_expired$"):
                GitHub("example/project").get(PREFIX + "issues/1")


class SubjectTests(unittest.TestCase):
    def observe(self, check, routes):
        adapter = Fake(routes)
        result = Collector("example/project", adapter).observe_check(check)
        return result, adapter.calls

    def test_historical_job_selects_its_attempt_after_latest_run_advances(self):
        for check_id in [None, "7"]:
            for run_id in [None, "8"]:
                with self.subTest(check_id=check_id, run_id=run_id):
                    check, routes = job_evidence()
                    check.update(check_id=check_id, run_id=run_id, attempt=None, source=ROOT + "/actions/runs/8/job/9")
                    latest = dict(routes["actions/runs/8"], run_attempt=2, conclusion="cancelled")
                    routes["actions/runs/8"] = latest
                    routes["actions/runs/8/attempts/2"] = latest
                    routes["actions/runs/8/attempts/2/jobs?per_page=100&page=1"] = {"jobs": []}
                    observed, _ = self.observe(check, routes)
                    self.assertEqual(observed["status"], "observed_fields_consistent")
                    self.assertEqual(observed["subject"]["kind"], "job")
                    self.assertEqual(observed["subject"]["attempt"], 1)
                    self.assertEqual(observed["fresh"]["run_attempt"]["run_attempt"], 1)
                    self.assertTrue(observed["relationships"]["subject_attempt"])
                    del routes["actions/runs/8/attempts/1"]
                    expired, _ = self.observe(check, routes)
                    self.assertEqual(expired["status"], "unverified")
                    self.assertIsNone(expired["fresh"]["run_attempt"])
                    self.assertEqual(expired["subject"]["attempt"], 1)

    def test_check_links_select_job_and_establish_run_attempt_relationship(self):
        for source in [ROOT + "/pull/3/checks?check_run_id=7", ROOT + "/actions/runs/8"]:
            for link_field in ["details_url", "html_url"]:
                with self.subTest(source=source, link_field=link_field):
                    check, routes = job_evidence()
                    check["source"] = source
                    link = routes["check-runs/7"].pop("details_url")
                    routes["check-runs/7"][link_field] = link
                    observed, calls = self.observe(check, routes)
                    self.assertEqual(observed["status"], "observed_fields_consistent")
                    self.assertIn(PREFIX + "actions/jobs/9", calls)
                    self.assertTrue(observed["relationships"]["check_job"])
                    for field, value, finding in [("run_attempt", 2, "identity_attempt"),
                                                   ("run_id", 99, "identity_run_id"),
                                                   ("check_run_url", "https://api.github.com/repos/example/project/check-runs/77", "identity_check_id")]:
                        changed = deepcopy(routes)
                        changed["actions/jobs/9"][field] = value
                        failed, _ = self.observe(check, changed)
                        self.assertEqual(failed["status"], "inconsistent")
                        self.assertIn(finding, failed["mismatches"])
                    del routes["actions/jobs/9"]
                    self.assertEqual(self.observe(check, routes)[0]["status"], "unverified")
                    del routes["check-runs/7"][link_field]
                    unlinked, _ = self.observe(check, routes)
                    self.assertEqual(unlinked["status"], "unverified")
                    self.assertIn("subject_attempt_relation_unavailable", unlinked["limitations"])
        # A standalone check needs no invented run/attempt relationship.
        check, routes = job_evidence()
        check.update(source=ROOT + "/pull/3/checks?check_run_id=7", run_id=None, attempt=None, workflow=None)
        del routes["check-runs/7"]["details_url"]
        self.assertEqual(self.observe(check, routes)[0]["status"], "observed_fields_consistent")

    def test_run_subject_uses_source_identity_and_its_own_observed_fields(self):
        check, routes = job_evidence()
        check.update(check_id=None, run_id=None, attempt=None, source=ROOT + "/actions/runs/8/attempts/1",
                     name="CI", conclusion="failure")
        observed, _ = self.observe(check, routes)
        self.assertEqual(observed["status"], "observed_fields_consistent")
        self.assertEqual(observed["subject"]["kind"], "run_attempt")
        for field, value in [("name", "wrong"), ("head", "b" * 40), ("conclusion", "success")]:
            with self.subTest(field=field):
                changed = dict(check, **{field: value})
                failed, _ = self.observe(changed, routes)
                self.assertEqual(failed["status"], "inconsistent")
                self.assertIn(field, failed["mismatches"])
        check["source"] = ROOT + "/actions/runs/8"
        unknown, _ = self.observe(check, routes)
        self.assertEqual(unknown["status"], "unverified")
        self.assertNotIn("run_attempt", unknown["fresh"])

    def test_workflow_context_is_checked_with_null_redundant_run_id(self):
        check, routes = job_evidence()
        check.update(run_id=None, attempt=None, workflow=".github/workflows/ci.yml (workflow ID 42)")
        routes["actions/runs/8/attempts/1"].update(path=".github/workflows/ci.yml", workflow_id=42)
        self.assertEqual(self.observe(check, routes)[0]["status"], "observed_fields_consistent")
        for field, value in [("path", ".github/workflows/wrong.yml"), ("workflow_id", 99)]:
            with self.subTest(field=field):
                changed = deepcopy(routes)
                changed["actions/runs/8/attempts/1"][field] = value
                self.assertEqual(self.observe(check, changed)[0]["status"], "inconsistent")
                del changed["actions/runs/8/attempts/1"][field]
                self.assertEqual(self.observe(check, changed)[0]["status"], "unverified")
        check["workflow"] = "unstructured description"
        self.assertEqual(self.observe(check, routes)[0]["status"], "unverified")

    def test_missing_live_fields_are_unknown_not_contradictions_or_evidence(self):
        for endpoint, fields in [("actions/jobs/9", ["id", "run_id", "run_attempt", "name", "head_sha", "conclusion"]),
                                 ("check-runs/7", ["id", "name", "head_sha", "conclusion"]),
                                 ("actions/runs/8/attempts/1", ["id", "run_attempt", "head_sha"])]:
            for field in fields:
                with self.subTest(endpoint=endpoint, field=field):
                    check, routes = job_evidence()
                    del routes[endpoint][field]
                    observed, _ = self.observe(check, routes)
                    self.assertEqual(observed["status"], "unverified")
                    self.assertNotIn("mismatches", observed)
        check, routes = job_evidence()
        del routes["actions/jobs/9"]["check_run_url"]
        # The check's explicit job link is sufficient in the other direction.
        self.assertEqual(self.observe(check, routes)[0]["status"], "observed_fields_consistent")
        del routes["check-runs/7"]["details_url"]
        self.assertEqual(self.observe(check, routes)[0]["status"], "unverified")

    def test_conclusion_ownership_and_explicit_identity_conflicts_are_preserved(self):
        check, routes = job_evidence()
        check["check_id"] = None
        observed, _ = self.observe(check, routes)
        self.assertEqual(observed["status"], "observed_fields_consistent")
        self.assertEqual(observed["fresh"]["source_job"]["conclusion"], "success")
        self.assertEqual(observed["fresh"]["run_attempt"]["conclusion"], "failure")
        for source, finding in [(ROOT + "/actions/runs/999/attempts/1/job/9", "identity_run_id"),
                                (ROOT + "/actions/runs/8/attempts/2/job/9", "identity_attempt"),
                                (ROOT + "/actions/runs/8/attempts/1/job/9?check_run_id=77", "identity_check_id")]:
            with self.subTest(source=source):
                check.update(run_id=None, attempt=None, source=source)
                observed, _ = self.observe(check, routes)
                self.assertEqual(observed["status"], "inconsistent")
                self.assertIn(finding, observed["mismatches"])

    def test_report_coverage_and_acceptance_require_subject_consistency(self):
        for state in ["consistent", "unlinked", "conflicting"]:
            with self.subTest(state=state):
                check, job_routes = job_evidence()
                check["source"] = ROOT + "/actions/runs/8"
                if state == "unlinked":
                    del job_routes["check-runs/7"]["details_url"]
                elif state == "conflicting":
                    job_routes["actions/jobs/9"]["run_attempt"] = 2
                accepted = event(stage="goal", outcome="passed", evidence={"sources": [], "checks": [check]})
                accepted["revision"].update(repository=ROOT, head=check["head"], tested=check["head"])
                routes = {**base_routes(), **job_routes}
                routes["issues/1"].update(state="closed")
                routes["issues/1/comments?per_page=100&page=1"] = [comment(1, fenced(accepted))]
                sha = check["head"]
                routes.update({f"commits/{sha}/check-runs?filter=all&per_page=100&page=1": {"check_runs": []},
                               f"commits/{sha}/statuses?per_page=100&page=1": [],
                               f"actions/runs?head_sha={sha}&per_page=100&page=1": {"workflow_runs": []}})
                report = Collector("example/project", Fake(routes)).collect([1])
                self.assertTrue(report["retrieval_complete"])
                self.assertTrue(report["record_coverage_complete"])
                self.assertEqual(report["evidence_coverage_complete"], state == "consistent")
                merged = {3: {"head": {"sha": sha}, "merged_at": "date", "state": "closed"}}
                score = score_goal(ROOT + "/issues/1", {"state": "closed"}, report["reconciliation"],
                                   merged, report["check_observations"], True)
                self.assertEqual(score["acceptance"], "recorded_with_live_consistency" if state == "consistent" else "unverified")


class ReconciliationTests(unittest.TestCase):
    def test_duplicate_publication_is_not_extra_cycle_or_record_correction(self):
        first = event(correction_cycle={"id": "cycle-1", "source_stage": "testing", "cause": "real failure"}, outcome="failed")
        fixed = event("fix", correction_cycle={"id": "cycle-1"}, stage="implementation", outcome="passed")
        retest = event("retest", correction_cycle={"id": "cycle-1"}, stage="testing", outcome="passed")
        result = reconcile([publication(first), publication(first, 2), publication(fixed, 3), publication(retest, 4)])
        score = score_goal(ROOT + "/issues/1", {"state": "open"}, result, {}, [], True)
        self.assertEqual(score["distinct_declared_cycle_count"], 1)
        self.assertEqual(score["whole_goal_cycle_total"], None)
        self.assertEqual(len(score["attempt_outcomes"]["attempt-1"]), 3)
        self.assertEqual(score["acceptance"], "not_recorded")
        self.assertEqual(score["record_corrections"], 0)

    def test_conflicting_ids_dangling_cycles_and_competing_replacements_are_quarantined(self):
        scenarios = [
            [event(), event(outcome="failed")],
            [event(supersedes=["missing"])],
            [event(supersedes=["b"]), event("b", supersedes=["event-a"])],
            [event(), event("b", supersedes=["event-a"]), event("c", supersedes=["event-a"])],
        ]
        for values in scenarios:
            with self.subTest(values=values):
                result = reconcile([publication(v, i) for i, v in enumerate(values)])
                self.assertEqual(result["active"], [])
                self.assertTrue(result["quarantined_ids"])

    def test_long_correction_chain_does_not_use_call_stack_depth(self):
        records = [publication(event(str(i), supersedes=[str(i + 1)] if i < 1100 else []))
                   for i in range(1101)]
        result = reconcile(records)
        self.assertEqual([r["event"]["event_id"] for r in result["active"]], ["0"])
        self.assertEqual(result["quarantined_ids"], [])

    def test_whole_event_replacement_and_cycle_conflicts_are_visible(self):
        old = event(outcome="failed")
        new = event("new", outcome="ongoing", supersedes=["event-a"])
        result = reconcile([publication(old), publication(new)])
        self.assertEqual([r["event"]["outcome"] for r in result["active"]], ["ongoing"])
        a = event("a", correction_cycle={"id": "c", "source_stage": "review", "cause": "first"})
        b = event("b", correction_cycle={"id": "c", "source_stage": "review", "cause": "second"})
        c = event("c", correction_cycle={"id": "unknown"})
        score = score_goal(ROOT + "/issues/1", {}, reconcile([publication(v) for v in [a, b, c]]), {}, [], True)
        self.assertEqual(score["cycle_conflicts"], ["c"])
        self.assertEqual(score["undeclared_cycle_references"], ["unknown"])

    def test_explicit_goal_acceptance_requires_exact_live_revision_consistency(self):
        accepted = event(stage="goal", outcome="passed")
        sha = "a" * 40
        accepted["revision"].update(repository=ROOT, head=sha, tested=sha)
        result = reconcile([publication(accepted)])
        prs = {3: {"head": {"sha": sha}, "merged_at": "date", "state": "closed"}}
        score = score_goal(ROOT + "/issues/1", {"state": "closed"}, result, prs, [], True)
        self.assertEqual(score["acceptance"], "recorded_with_live_consistency")
        score = score_goal(ROOT + "/issues/1", {"state": "closed"}, result, prs, [], False)
        self.assertEqual(score["acceptance"], "unverified")
        accepted["revision"]["tested"] = "b" * 40
        score = score_goal(ROOT + "/issues/1", {"state": "closed"}, result, prs, [], True)
        self.assertEqual(score["acceptance"], "inconsistent")

    def test_closure_or_stage_pass_never_establishes_goal_acceptance(self):
        for value in [None, event(stage="closeout", outcome="passed")]:
            result = reconcile([publication(value)] if value else [])
            score = score_goal(ROOT + "/issues/1", {"state": "closed"}, result, {}, [], True)
            self.assertEqual(score["acceptance"], "not_recorded")
        accepted = event(stage="goal", outcome="passed")
        score = score_goal(ROOT + "/issues/1", {"state": "open"}, reconcile([publication(accepted)]), {}, [], True)
        self.assertEqual(score["acceptance"], "inconsistent")


if __name__ == "__main__":
    unittest.main()
