"""Synthetic boundary cases for the GitHub event interchange contract."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_stage_event import SCHEMA, validate_file
from jsonschema.exceptions import ValidationError


class StageEventTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "event.json"
        self.event = json.loads(SCHEMA.with_name("stage-event.example.json").read_text())

    def write(self, event):
        self.path.write_text(json.dumps(event))
        return self.path

    def test_blocked_unknown_and_complete_observation(self):
        validate_file(self.write(self.event))
        self.event["outcome"] = "passed"
        self.event["findings"] = []
        self.event["evidence"]["checks"][0].update(
            check_id="456", conclusion="success", workflow_revision="3" * 40,
            head="4" * 40, revision_relation="Synthetic merge of the recorded base and head.",
        )
        self.event["cost"] = {
            "amount": "0.125", "currency": "USD",
            "source": "https://github.com/example/project/issues/42#issuecomment-102",
        }
        validate_file(self.write(self.event))

    def test_malformed_or_ambiguous_contract_fields(self):
        changes = [
            ("schema_version", 2), ("outcome", "accepted_probably"),
            ("supersedes", ["same", "same"]), ("owner", ""),
            ("revision", {**self.event["revision"], "tested": "main"}),
            ("execution", {**self.event["execution"], "observed_model": ""}),
            ("timing", {**self.event["timing"], "elapsed_seconds": -1}),
            ("cost", {"amount": 0.125, "currency": "USD", "source": "https://example.com"}),
        ]
        for field, value in changes:
            with self.subTest(field=field):
                event = copy.deepcopy(self.event)
                event[field] = value
                with self.assertRaises(ValidationError):
                    validate_file(self.write(event))
        event = copy.deepcopy(self.event)
        del event["execution"]["observed_model"]
        with self.assertRaises(ValidationError):
            validate_file(self.write(event))

    def test_marker_required_and_distinct_from_unrelated_json(self):
        for marker in (None, "unrelated.record", 1):
            with self.subTest(marker=marker):
                event = copy.deepcopy(self.event)
                if marker is None:
                    del event["record_type"]
                else:
                    event["record_type"] = marker
                with self.assertRaises(ValidationError):
                    validate_file(self.write(event))

    def test_optional_cycle_declaration_and_reference_shapes(self):
        self.event.pop("correction_cycle", None)
        validate_file(self.write(self.event))
        for cycle in (
            None, {"id": "example-cycle-001"},
            {"id": "example-cycle-001", "source_stage": "review", "cause": "Observed defect"},
        ):
            with self.subTest(cycle=cycle):
                self.event["correction_cycle"] = cycle
                validate_file(self.write(self.event))
        for cycle in (
            {}, {"id": ""}, {"id": "has spaces"}, {"id": 1},
            {"id": "example-cycle-001", "source_stage": "review"},
            {"id": "example-cycle-001", "cause": "Observed defect"},
            {"id": "example-cycle-001", "source_stage": "setup", "cause": "Observed defect"},
        ):
            with self.subTest(cycle=cycle):
                self.event["correction_cycle"] = cycle
                with self.assertRaises(ValidationError):
                    validate_file(self.write(self.event))

    def test_check_attempt_and_unrecognized_data(self):
        for attempt in (0, -1, "2"):
            with self.subTest(attempt=attempt):
                event = copy.deepcopy(self.event)
                event["evidence"]["checks"][0]["attempt"] = attempt
                with self.assertRaises(ValidationError):
                    validate_file(self.write(event))
        self.event["private_chat"] = "must not enter the contract"
        with self.assertRaises(ValidationError):
            validate_file(self.write(self.event))

    def test_correction_cannot_replace_itself_or_duplicate_json_keys(self):
        self.event["supersedes"] = ["example-earlier-event"]
        validate_file(self.write(self.event))
        self.event["supersedes"] = [self.event["event_id"]]
        with self.assertRaises(ValueError):
            validate_file(self.write(self.event))
        self.path.write_text('{"outcome":"failed","outcome":"passed"}')
        with self.assertRaises(ValueError):
            validate_file(self.path)
        for invalid in (float("nan"), float("inf")):
            self.event["supersedes"] = []
            self.event["timing"]["elapsed_seconds"] = invalid
            with self.assertRaises(ValueError):
                validate_file(self.write(self.event))

    def test_cli_failure_is_nonzero_without_record_values(self):
        for content in ('{"secret-value": "private-financial-data"}', '"private-financial-data'):
            self.path.write_text(content)
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("check_stage_event.py")), str(self.path)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertNotIn("secret-value", result.stdout + result.stderr)
            self.assertNotIn("private-financial-data", result.stdout + result.stderr)
        self.path.unlink()
        with self.assertRaises(OSError):
            validate_file(self.path)

    def test_raw_exponents_preserve_finite_timing_or_fail_safely(self):
        template = json.dumps(self.event)
        for number, expected in (("1e400", 1), ("-1e400", 1), ("1e300", 0), ("1.25", 0)):
            with self.subTest(number=number):
                self.path.write_text(template.replace('"elapsed_seconds": null', f'"elapsed_seconds": {number}'))
                result = subprocess.run(
                    [sys.executable, str(Path(__file__).with_name("check_stage_event.py")), str(self.path)],
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, expected)
                self.assertNotIn(number, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
