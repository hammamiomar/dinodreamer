"""Fixture storage preserves the recorded numerics and the repository's file size limit."""
import json
from pathlib import Path
import tempfile
import unittest

from prepare_grow_recipe import MAX_FIXTURE_BYTES, write_fixture


class FixtureStorageTests(unittest.TestCase):
    def test_inline_and_split_records_preserve_every_value(self):
        directory = Path(__file__).with_name("fixtures")
        for name in (
            "grow-recipe-oracle-12002-batch4.json",
            "grow-recipe-oracle-12002-pyramid-batch4.json",
        ):
            with self.subTest(fixture=name), tempfile.TemporaryDirectory() as temporary:
                expected = json.loads((directory / name).read_text())
                if "updateFiles" in expected:
                    expected["updates"] = [
                        json.loads((directory / file).read_text())
                        for file in expected.pop("updateFiles")
                    ]
                output = Path(temporary) / name
                write_fixture(output, expected)
                restored = json.loads(output.read_text())
                if "updateFiles" in restored:
                    restored["updates"] = [
                        json.loads((output.parent / file).read_text())
                        for file in restored.pop("updateFiles")
                    ]
                self.assertEqual(restored, expected)
                for file in output.parent.rglob("*.json"):
                    self.assertLessEqual(file.stat().st_size, MAX_FIXTURE_BYTES, file.name)


if __name__ == "__main__":
    unittest.main()
