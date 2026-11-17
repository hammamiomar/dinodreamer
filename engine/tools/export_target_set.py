"""Write a target set as raw pixels: one PNG sheet of its 128 px windows and a JSON record of each
picture's source, patch and dot. Two sources:

- `--name`: a saved set of the given-set tool (research/given-set/out/sets/<name>.pt), the research's
  own set. Its pole is the 33 strongest distinct public pictures of the 4,096-row sample frozen in
  the group's input file, which is the published clouds/<block>.json.
- `--strongest <block>`: the set from the published strongest file (the top 1,024 rows of the whole
  cloud) by the same rule (`selection.Band(block, "pole", source="strongest")`), with the windows
  cut from the PNG previews the browser reads. Downloads go to `--cache`.

A set holds the 3 x 3 tokens around one patch of each picture. The window is the aligned 128 px
window of the 256 px picture that holds the patch nearest its centre (`library.aligned_window`);
the dot is that patch's position on the window's 8 x 8 grid. The sheet is lossless, so the CPU
oracle (`prepare_grow_recipe.py --set`) and the engine read the same bytes. Windows are laid
row-major, `COLUMNS` to a row.

Usage: python engine/tools/export_target_set.py --given-set <research/given-set> --name block-12002-pole-3x3 --output <set.json>
       python engine/tools/export_target_set.py --given-set <research/given-set> --strongest 13633 --cache <folder> --output <set.json>
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

COLUMNS = 11
WINDOW_SIDE = 128
PICTURE_SIDE = 256


def research_set(library, given_set_root: Path, name: str) -> tuple[list[np.ndarray], list[dict], dict]:
    """The windows [128, 128, 3] and pictures of a saved set, and its provenance."""
    path = given_set_root / "out" / "sets" / f"{name}.pt"
    saved = torch.load(path, map_location="cpu", weights_only=False)
    if saved["neighbourhood"] != "3x3":
        raise SystemExit(f"{name} holds the {saved['neighbourhood']} neighbourhood; the engine's sets hold the 3 x 3")
    blank_HW3 = np.zeros((PICTURE_SIDE, PICTURE_SIDE, 3), np.uint8)
    pictures = [
        {"source": source, "patch": int(patch), "dot": int(library.aligned_window(blank_HW3, int(patch))[1])}
        for source, patch in zip(saved["sources"], saved["patches"])
    ]
    provenance = {
        "researchSet": name,
        "researchSetSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "selection": saved["selection"],
        "cloudCheck": saved["record"].get("cloud_check"),
        "tokens": saved["record"].get("tokens_per_scale"),
    }
    return list(saved["windows_P3HW"].permute(0, 2, 3, 1).numpy()), pictures, provenance


def strongest_set(library, selection, block: int, cache: Path) -> tuple[list[np.ndarray], list[dict], dict]:
    """The pole of the strongest file, its windows cut from the PNG previews, and its provenance."""
    import anchor_pictures  # noqa: E402  (on sys.path through givenset.paths)

    library.CLOUD_CACHE = cache / "clouds"  # load_cloud reads its cache path at call time: downloads stay in --cache
    patches = selection.Band(block, "pole", source="strongest").resolve()
    windows, pictures = [], []
    for patch in patches:
        path = cache / "previews" / f"{patch.source}.png"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(anchor_pictures.fetch(f"web/v2/assets/{anchor_pictures.ASSET}/previews/{patch.source}.png"))
        pixels_HW3 = np.asarray(Image.open(io.BytesIO(path.read_bytes())).convert("RGB"), np.uint8)
        window_HW3, dot = library.aligned_window(pixels_HW3, patch.patch)
        windows.append(window_HW3)
        pictures.append({"source": int(patch.source), "patch": int(patch.patch), "dot": int(dot)})
    selection_record = {"block": block, "level": "pole", "pictures": len(patches), "source": "strongest"}
    return windows, pictures, {"selection": selection_record, "asset": anchor_pictures.ASSET}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--given-set", type=Path, required=True, help="the given-set tool, research/given-set")
    parser.add_argument("--name", help="a saved set under out/sets, e.g. block-12002-pole-3x3")
    parser.add_argument("--strongest", type=int, help="a basis group: its set from the published strongest file")
    parser.add_argument("--cache", type=Path, help="with --strongest: where the strongest file and the previews are kept")
    parser.add_argument("--output", type=Path, required=True, help="the set's JSON; the sheet is written beside it")
    args = parser.parse_args()
    if (args.name is None) == (args.strongest is None) or (args.strongest is not None and args.cache is None):
        raise SystemExit("Give --name, or --strongest with --cache")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(args.given_set.resolve()))
    from givenset import library, selection  # noqa: E402

    if args.name:
        windows, pictures, provenance = research_set(library, args.given_set, args.name)
        block = provenance["selection"]["block"]
    else:
        windows, pictures, provenance = strongest_set(library, selection, args.strongest, args.cache)
        block = args.strongest
    rows = -(-len(pictures) // COLUMNS)
    sheet_HW3 = np.zeros((rows * WINDOW_SIDE, COLUMNS * WINDOW_SIDE, 3), np.uint8)
    for index, window_HW3 in enumerate(windows):
        row, column = divmod(index, COLUMNS)
        sheet_HW3[row * WINDOW_SIDE:(row + 1) * WINDOW_SIDE, column * WINDOW_SIDE:(column + 1) * WINDOW_SIDE] = window_HW3
    sheet = args.output.with_suffix(".png")
    Image.fromarray(sheet_HW3).save(sheet, optimize=True)
    record = {
        "format": 1,
        "purpose": "A target set as raw pixels: 128 px windows and the dot of each (tools/export_target_set.py).",
        "block": block,
        "neighbourhood": "3x3",
        "sheet": sheet.name,
        "columns": COLUMNS,
        "pictures": pictures,
        "provenance": provenance,
    }
    args.output.write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps({"output": str(args.output), "pictures": len(pictures), "sheetBytes": sheet.stat().st_size}))


if __name__ == "__main__":
    main()
