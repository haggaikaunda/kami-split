"""Validate one local stage event without publishing it or echoing its contents."""

import json
import math
from pathlib import Path
import sys

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError


SCHEMA = Path(__file__).resolve().parents[2] / "docs/agents/records/stage-event.schema.json"


def unique_object(pairs):
    """Reject duplicate JSON keys instead of accepting a last-write-wins record."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(_value):
    """Reject Python JSON extensions such as NaN and Infinity."""
    raise ValueError("Non-JSON number")


def finite_float(value):
    """Reject legal JSON exponents that overflow Python's numeric representation."""
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("Non-finite JSON number")
    return parsed


def validate_file(path):
    """Check syntax and the versioned contract; never establish evidence truth."""
    schema = json.loads(SCHEMA.read_text())
    Draft202012Validator.check_schema(schema)
    event = json.loads(
        Path(path).read_text(), object_pairs_hook=unique_object,
        parse_constant=reject_constant,
        parse_float=finite_float,
    )
    Draft202012Validator(schema).validate(event)
    if event["event_id"] in event["supersedes"]:
        raise ValueError("An event cannot supersede itself")


def main(args):
    if len(args) != 1:
        print("Usage: check_stage_event.py <local-event.json>", file=sys.stderr)
        return 2
    try:
        validate_file(args[0])
    except (OSError, ValueError, UnicodeError):
        print("Stage event unreadable or invalid JSON/identity; inspect locally.", file=sys.stderr)
        return 1
    except (SchemaError, ValidationError):
        # jsonschema errors can contain submitted values and arbitrary keys.
        # Fixed diagnostics keep private record data out of terminal/CI logs.
        print("Stage event does not satisfy the versioned schema; inspect locally.", file=sys.stderr)
        return 1
    print("Stage event contract valid; truth and freshness require independent checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
