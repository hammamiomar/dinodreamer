"""An explicit audit of the browser's target sets against the research's, for a few basis groups.
It is not part of training: run it when the set's source, the library or the rule changes.

For each group it compares two lists of 33 set pictures, each the strongest distinct public
pictures by code norm, first row of each picture (`selection.Band(block, "pole")`):
- the research's, from the 4,096-row public sample frozen in the group's input file ("sample");
- the browser's, from the published strongest file, the top 1,024 rows of the whole cloud ("strongest").
It then reads the browser's pictures as the browser gets them and reports:
- which pictures have no PNG preview (the research then falls back to a lossy WebP thumbnail);
- the PNG previews' format: 8-bit RGB without colour chunks decodes to the same bytes in PIL and
  in the engine's PNG decoder (`assets::decode_preview`), so the windows' tolerance is 0;
- the research's cloud check (`given_set.checked`): the code recomputed at the patch of the 256 px
  picture against the cloud row's code, failing above 5 % norm error or below 0.98 cosine. The
  research drops a failing picture; the browser does not run this check.

All research code is imported read-only. Downloads go to `--cache`, never into the research checkout.

Usage: python engine/tools/audit_target_sets.py --research <checkout> --dino-source <source> --dino-weights <checkpoint>
  --bundle <bundle> --cache <folder> --output <report.json> 12002 7178 ...
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

PNG_COLOUR_CHUNKS = (b"gAMA", b"iCCP", b"sRGB", b"cHRM")


def png_format(data: bytes) -> dict:
    """The PNG's size, bit depth, colour type and colour-management chunks, from its header and chunk list."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    depth, colour = data[24], data[25]
    chunks, offset = [], 8
    while offset < len(data):
        length = int.from_bytes(data[offset:offset + 4], "big")
        chunks.append(data[offset + 4:offset + 8])
        offset += 12 + length
    return {"width": width, "height": height, "bitDepth": depth, "colourType": colour,
            "colourChunks": [chunk.decode() for chunk in chunks if chunk in PNG_COLOUR_CHUNKS]}


def cached(cache: Path, name: str, fetch) -> bytes | None:
    path = cache / name
    if path.exists():
        return path.read_bytes()
    try:
        data = fetch()
    except Exception as error:  # noqa: BLE001  (a 404 is a finding, not a failure)
        if getattr(error, "code", None) == 404:
            return None
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--research", type=Path, required=True, help="the research checkout holding research/given-set")
    parser.add_argument("--dino-source", type=Path, required=True)
    parser.add_argument("--dino-weights", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True, help="downloads: strongest files and previews")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--no-check", action="store_true", help="skip the cloud check, which reads every picture with DINO")
    parser.add_argument("blocks", type=int, nargs="+")
    args = parser.parse_args()
    started = time.perf_counter()
    torch.set_num_threads(8)
    sys.dont_write_bytecode = True
    objective_dynamics = args.research / "research/2026-10-22-objective-dynamics"
    sys.path[:0] = [str(args.bundle.resolve()), str((args.research / "src").resolve()), str(objective_dynamics.resolve()),
                    str((args.research / "research/given-set").resolve())]
    __import__("bsf")
    from givenset import given_set, library, selection  # noqa: E402
    from givenset.reader import FINAL, Reader  # noqa: E402
    import anchor_pictures  # noqa: E402
    import original_recipe as original  # noqa: E402

    library.CLOUD_CACHE = args.cache / "clouds"  # load_cloud reads its cache path at call time: downloads stay in --cache
    reader = None
    if not args.no_check:
        dino = original.load_dinov3(args.dino_source, args.dino_weights, torch.device("cpu"))
        model = original.bsf.load_bundle(args.bundle, torch.device("cpu"))
        reader = Reader("cpu", dino=dino, model=model)
    preview = lambda image_id: f"web/v2/assets/{anchor_pictures.ASSET}/previews/{image_id}.png"  # noqa: E731
    groups = []
    for block in args.blocks:
        research = selection.Band(block, "pole").resolve()
        browser = selection.Band(block, "pole", source="strongest").resolve()
        pairs = lambda patches: {(int(patch.source), patch.patch) for patch in patches}  # noqa: E731
        pictures = lambda patches: {int(patch.source) for patch in patches}  # noqa: E731
        group = {
            "block": block,
            "pictures": [len(research), len(browser)],
            "sharedPictures": len(pictures(research) & pictures(browser)),
            "sharedPatches": len(pairs(research) & pairs(browser)),
            "norms": {"research": [round(min(p.norm for p in research), 3), round(max(p.norm for p in research), 3)],
                      "browser": [round(min(p.norm for p in browser), 3), round(max(p.norm for p in browser), 3)]},
            "noPreview": [], "formats": {}, "check": [],
        }
        for patch in browser:
            data = cached(args.cache, f"previews/{patch.source}.png", lambda: anchor_pictures.fetch(preview(patch.source)))
            if data is None:
                group["noPreview"].append(int(patch.source))
                continue
            form = png_format(data)
            key = f"{form['width']}x{form['height']} depth {form['bitDepth']} colour {form['colourType']} chunks {','.join(form['colourChunks']) or 'none'}"
            group["formats"][key] = group["formats"].get(key, 0) + 1
            if reader is None:
                continue
            pixels = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), np.uint8)
            with torch.no_grad():
                native_TD = reader.read(given_set.tensor_of(pixels, "cpu"), (FINAL,)).tokens[FINAL][0]
                error, cosine = given_set.checked(reader, native_TD, patch, block)
            group["check"].append({"source": int(patch.source), "patch": patch.patch, "normError": round(error, 5), "cosine": round(cosine, 5),
                                   "fails": error > given_set.RELATIVE_NORM_TOLERANCE or cosine < given_set.COSINE_TOLERANCE})
        checks = group["check"]
        if checks:
            errors = [row["normError"] for row in checks]
            group["checkSummary"] = {"pictures": len(checks), "failed": sum(row["fails"] for row in checks),
                                     "medianNormError": float(np.median(errors)), "worstNormError": max(errors),
                                     "worstCosine": min(row["cosine"] for row in checks)}
        print(json.dumps({key: group[key] for key in ("block", "sharedPictures", "sharedPatches", "norms", "noPreview", "formats")}
                         | {"checkSummary": group.get("checkSummary")}), flush=True)
        groups.append(group)
    report = {
        "purpose": "The browser's target sets (strongest file, PNG previews) against the research's (frozen sample); "
                   "tools/audit_target_sets.py.",
        "groups": groups,
        "provenance": {"oracleSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       "selectionSha256": hashlib.sha256((args.research / "research/given-set/givenset/selection.py").read_bytes()).hexdigest(),
                       "asset": anchor_pictures.ASSET, "seconds": round(time.perf_counter() - started, 1)},
    }
    args.output.write_text(json.dumps(report, indent=1) + "\n")


if __name__ == "__main__":
    main()
