"""Validate live skills with skills-ref plus narrow repository resource contracts."""

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

try:
    from markdown_it import MarkdownIt
    from skills_ref.parser import parse_frontmatter
    from skills_ref.validator import validate
except ImportError:
    sys.exit("Install the pinned validator using docs/agents/skill-authoring.md.")


def local_links(path, root):
    """Check parsed Markdown file destinations; anchors/network stay manual."""
    errors = []
    destinations = []
    for block in MarkdownIt().parse(path.read_text()):
        for token in block.children or []:
            if token.type == "link_open":
                destinations.append(token.attrGet("href"))
            elif token.type == "image":
                destinations.append(token.attrGet("src"))
    for raw in destinations:
        target = urlsplit(raw)
        if target.scheme or target.netloc or not target.path:
            continue
        destination = (path.parent / unquote(target.path)).resolve()
        if not destination.is_relative_to(root) or not destination.is_file():
            errors.append(f"{path.relative_to(root)}: missing/outside local file {raw}")
    return errors


def check(root):
    """Return diagnostics without executing skill contents or following symlinks."""
    root = Path(root).resolve()
    directory = root / ".agents/skills"
    if not directory.is_dir() or directory.is_symlink() or directory.parent.is_symlink():
        return ["Missing or symlinked .agents/skills directory"]
    errors = []
    skills = sorted(directory.iterdir())
    if not skills:
        return ["No live skills found"]
    for skill in skills:
        label = skill.relative_to(root)
        if skill.is_symlink() or not skill.is_dir():
            errors.append(f"{label}: expected a real skill directory")
            continue
        resources = [skill, *skill.rglob("*")]
        if any(p.is_symlink() or not p.resolve().is_relative_to(root) for p in resources):
            errors.append(f"{label}: resources must be contained and not symlinked")
            continue
        source = skill / "SKILL.md"
        if not source.is_file():
            errors.append(f"{label}: missing SKILL.md")
            continue
        try:
            problems = validate(skill)
            errors.extend(f"{label}: {problem}" for problem in problems)
            if problems:
                continue
            metadata, body = parse_frontmatter(source.read_text())
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", metadata["name"]):
                errors.append(f"{label}: use a portable ASCII hyphenated name")
            extra = metadata.get("metadata", {})
            if not isinstance(extra, dict) or any(
                not isinstance(k, str) or not isinstance(v, str) for k, v in extra.items()
            ):
                errors.append(f"{label}: metadata must map strings to strings")
            if not body.strip():
                errors.append(f"{label}: empty procedure")
            for resource in resources:
                if resource.is_file() and resource.suffix == ".md":
                    errors.extend(local_links(resource, root))
        except (ValueError, TypeError, OSError, UnicodeError) as error:
            # Do not echo source contents or arbitrary exception text.
            errors.append(f"{label}: cannot validate ({type(error).__name__})")
    return errors


if __name__ == "__main__":
    problems = check(Path(__file__).resolve().parents[2])
    print("\n".join(problems) if problems else "Live skills and local resources validated.")
    sys.exit(bool(problems))
