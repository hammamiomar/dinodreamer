"""The categories file of a provenance table: letters, block order and the table check."""

import unittest

from prepare_provenance_categories import LETTERS, category_letters, prepare_categories

PROVENANCE = {"table_sha256": "0b11859663634baf" + "0" * 48, "family_rule": "the table's family column"}


def table(blocks, families):
    return {"table_sha256": PROVENANCE["table_sha256"], "roles": {"patch": {"block": blocks, "family": families}}}


class CategoryLettersTest(unittest.TestCase):
    def test_one_letter_per_block_in_block_order(self):
        letters = category_letters([0, 2, 3, 5, 6], ["surround", "local", None, "position", "global"], 8)
        # Blocks 1, 4 and 7 have no record; block 3 has fewer than 100 sample tokens.
        self.assertEqual(letters, "S-L--PG-")

    def test_refuses_a_block_outside_the_dictionary(self):
        with self.assertRaisesRegex(ValueError, "outside the dictionary"):
            category_letters([8], ["local"], 8)

    def test_refuses_a_word_without_a_letter(self):
        with self.assertRaisesRegex(ValueError, "has no letter"):
            category_letters([1], ["context"], 8)


class PrepareCategoriesTest(unittest.TestCase):
    def test_names_the_table_and_its_rule_and_lists_every_letter(self):
        categories = prepare_categories(table([1], ["neighbourhood"]), PROVENANCE, 3)
        self.assertEqual(categories["table"], "0b11859663634baf")
        self.assertEqual(categories["rule"], "the table's family column")
        self.assertEqual(categories["letters"], LETTERS)
        self.assertEqual(categories["roles"], {"patch": "-N-"})

    def test_refuses_a_table_that_the_manifest_does_not_name(self):
        other = {**table([1], ["local"]), "table_sha256": "f" * 64}
        with self.assertRaisesRegex(ValueError, "not the table"):
            prepare_categories(other, PROVENANCE, 3)


if __name__ == "__main__":
    unittest.main()
