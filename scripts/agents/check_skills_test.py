"""Malformed inputs and filesystem boundaries, independent of installed prose."""

import tempfile
import unittest
from pathlib import Path

from check_skills import check


class SkillValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.skill = self.root / ".agents/skills/example-skill"
        self.skill.mkdir(parents=True)
        self.source = self.skill / "SKILL.md"
        self.valid = "---\nname: example-skill\ndescription: Inspect a bounded example.\n---\nDo the task.\n"
        self.source.write_text(self.valid)

    def test_valid_and_real_relative_resource(self):
        (self.root / "guide.md").write_text("Current guidance")
        self.source.write_text(self.valid + "[guide](../../../guide.md#manual-anchor)\n")
        self.assertEqual(check(self.root), [])

    def test_upstream_rejects_malformed_or_missing_metadata(self):
        for source in (
            "No frontmatter",
            self.valid.replace("name: example-skill", "name: different-name"),
            self.valid.replace("description: Inspect a bounded example.", "description:"),
            self.valid.replace("name: example-skill", "name: example-skill\nname: duplicate"),
            self.valid.replace("name: example-skill", "unknown: value"),
        ):
            with self.subTest(source=source):
                self.source.write_text(source)
                self.assertTrue(check(self.root))

    def test_missing_and_escaping_links(self):
        for destination in ("missing.md", "../../../../outside.md", "/etc/passwd"):
            with self.subTest(destination=destination):
                self.source.write_text(self.valid + f"[reference]({destination})")
                self.assertTrue(check(self.root))

    def test_symlink_resources_are_not_followed(self):
        (self.skill / "outside.md").symlink_to("/etc/passwd")
        self.assertTrue(check(self.root))

    def test_markdown_titles_spaces_references_and_images(self):
        for link in (
            '[source](missing.md "Guide")',
            '[source](<missing guide.md>)',
            '[source][ref]\n\n[ref]: missing.md "Guide"',
            '![diagram](missing.png)',
        ):
            with self.subTest(link=link):
                self.source.write_text(self.valid + link)
                self.assertTrue(check(self.root))
        (self.skill / "real guide.md").write_text("Guidance")
        self.source.write_text(self.valid + '[source](<real guide.md> "Guide")')
        self.assertEqual(check(self.root), [])

    def test_code_examples_do_not_become_live_links(self):
        self.source.write_text(self.valid + '\n```text\n[example](missing.md)\n```\n')
        self.assertEqual(check(self.root), [])

    def test_empty_body_and_wrong_metadata_type(self):
        self.source.write_text(self.valid.rsplit("---", 1)[0] + "---\n")
        self.assertTrue(check(self.root))
        self.source.write_text(self.valid.replace("description:", "metadata: wrong\ndescription:"))
        self.assertTrue(check(self.root))

    def test_empty_inventory_and_missing_skill_source(self):
        self.source.unlink()
        self.assertTrue(check(self.root))
        self.skill.rmdir()
        self.assertTrue(check(self.root))


if __name__ == "__main__":
    unittest.main()
