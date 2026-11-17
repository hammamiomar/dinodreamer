"""Write a target set as raw pixels for the engine's parity: a saved set of the given-set tool
(research/given-set/out/sets/<name>.pt) becomes one PNG sheet of its 128 px windows and a JSON
record of each picture's source, patch and dot.

A set holds the 3 x 3 tokens around one patch of each picture. The window is the aligned 128 px
window of the 256 px picture that holds the patch nearest its centre (`library.aligned_window`);
the dot is that patch's position on the window's 8 x 8 grid. The sheet is lossless, so the CPU
oracle (`prepare_grow_recipe.py --set`) and the engine read the same bytes. Windows are laid
row-major, `COLUMNS` to a row.

Usage: python engine/tools/export_target_set.py --given-set <research/given-set> --name block-12002-pole-3x3 --output <set.json>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

COLUMNS = 11
WINDOW_SIDE = 128
PICTURE_SIDE = 256


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--given-set", type=Path, required=True, help="the given-set tool, research/given-set")
    parser.add_argument("--name", required=True, help="a saved set under out/sets, e.g. block-12002-pole-3x3")
    parser.add_argument("--output", type=Path, required=True, help="the set's JSON; the sheet is written beside it")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(args.given_set.resolve()))
    from givenset import library  # noqa: E402

    path = args.given_set / "out" / "sets" / f"{args.name}.pt"
    saved = torch.load(path, map_location="cpu", weights_only=False)
    if saved["neighbourhood"] != "3x3":
        raise SystemExit(f"{args.name} holds the {saved['neighbourhood']} neighbourhood; the engine's sets hold the 3 x 3")
    windows_PHW3 = saved["windows_P3HW"].permute(0, 2, 3, 1).numpy()
    blank_HW3 = np.zeros((PICTURE_SIDE, PICTURE_SIDE, 3), np.uint8)
    pictures = [
        {"source": source, "patch": int(patch), "dot": int(library.aligned_window(blank_HW3, int(patch))[1])}
        for source, patch in zip(saved["sources"], saved["patches"])
    ]
    rows = -(-len(pictures) // COLUMNS)
    sheet_HW3 = np.zeros((rows * WINDOW_SIDE, COLUMNS * WINDOW_SIDE, 3), np.uint8)
    for index, window_HW3 in enumerate(windows_PHW3):
        row, column = divmod(index, COLUMNS)
        sheet_HW3[row * WINDOW_SIDE:(row + 1) * WINDOW_SIDE, column * WINDOW_SIDE:(column + 1) * WINDOW_SIDE] = window_HW3
    sheet = args.output.with_suffix(".png")
    Image.fromarray(sheet_HW3).save(sheet, optimize=True)
    record = {
        "format": 1,
        "purpose": "A target set as raw pixels: the 128 px windows of a given-set tool's saved set (tools/export_target_set.py).",
        "block": saved["block"],
        "neighbourhood": saved["neighbourhood"],
        "sheet": sheet.name,
        "columns": COLUMNS,
        "pictures": pictures,
        "provenance": {
            "researchSet": args.name,
            "researchSetSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "selection": saved["selection"],
            "cloudCheck": saved["record"].get("cloud_check"),
            "tokens": saved["record"].get("tokens_per_scale"),
        },
    }
    args.output.write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps({"output": str(args.output), "pictures": len(pictures), "sheetBytes": sheet.stat().st_size}))


if __name__ == "__main__":
    main()
