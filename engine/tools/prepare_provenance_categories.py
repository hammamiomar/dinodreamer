"""Write a provenance table's response categories as one small file, categories.json.

Explore filters and labels every block by its response category.
The table's table.json has the category column, but the file is 14.6 MB
(5.7 MB with Brotli). categories.json has one letter per block of the dictionary, about
16 kB (about 4 kB with Brotli). Make it again with every new provenance table:

    python3 engine/tools/prepare_provenance_categories.py <table.json> <release manifest> <categories.json>

The release manifest (releases/<name>.json) must name the table: its table_sha256 must be
the one in table.json. The output path is normally <provenance prefix>/categories.json.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

# One letter per category word the table stores, in display order; "-" is a block with no
# category: fewer than 100 sample tokens, or no record in the role.
LETTERS = {
    "L": "local",
    "N": "neighbourhood",
    "S": "surround",
    "G": "global",
    "P": "position",
    "-": None,
}
LETTER_OF_WORD = {word: letter for letter, word in LETTERS.items()}
# Explore shows the patch role. Another role can join the file under its own key.
ROLES = ("patch",)
FORMAT = 1


def category_letters(blocks: list[int], families: list[str | None], dictionary_blocks: int) -> str:
    """One letter per block of the dictionary, in block order, from a role's two table columns."""
    letters = ["-"] * dictionary_blocks
    for block, family in zip(blocks, families, strict=True):
        if not 0 <= block < dictionary_blocks:
            raise ValueError(f"block {block} is outside the dictionary of {dictionary_blocks} blocks")
        # A word a later table adds needs its own letter here before the file can hold it.
        if family not in LETTER_OF_WORD:
            raise ValueError(f"block {block}: {family!r} has no letter in LETTERS")
        letters[block] = LETTER_OF_WORD[family]
    return "".join(letters)


def prepare_categories(table: dict, provenance: dict, dictionary_blocks: int) -> dict:
    """categories.json for `table` (table.json), named by the manifest's `provenance` entry."""
    if table["table_sha256"] != provenance["table_sha256"]:
        raise ValueError("table.json is not the table that the release manifest names")
    roles = {}
    for role in ROLES:
        columns = table["roles"][role]
        roles[role] = category_letters(columns["block"], columns["family"], dictionary_blocks)
    return {
        "format": FORMAT,
        "table": provenance["table_sha256"][:16],
        "rule": provenance["family_rule"],
        "letters": LETTERS,
        "roles": roles,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("table", type=Path, help="the provenance table's table.json")
    parser.add_argument("release", type=Path, help="the release manifest, releases/<name>.json")
    parser.add_argument("output", type=Path, help="categories.json to write")
    arguments = parser.parse_args()
    table = json.loads(arguments.table.read_text())
    release = json.loads(arguments.release.read_text())
    categories = prepare_categories(table, release["library"]["provenance"], release["model"]["blocks"])
    text = json.dumps(categories, separators=(",", ":")) + "\n"
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(text)
    for role, letters in categories["roles"].items():
        counts = Counter(letters)
        listed = ", ".join(f"{LETTERS[letter] or 'none'} {counts[letter]}" for letter in LETTERS)
        print(f"{role}: {len(letters)} blocks: {listed}")
    print(f"{arguments.output}: {len(text.encode())} bytes, sha256 {hashlib.sha256(text.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
