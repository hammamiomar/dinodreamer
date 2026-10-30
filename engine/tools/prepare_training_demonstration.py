"""Prepare the home page's story records once per release (CPU only).

The home (app/src/features/home/) tells how one published material came to be: the library
picture and patch its rule was trained toward, the blocks that fire on that patch, the block's
Atlas cloud with that patch as a dot, the training to the first fire, and the material itself.
Each record follows one fired material, so every station of a visit shows the same chain. Writes
app/public/story/story.json and one training strip per record (the tick-600 readout of every 25
updates up to the first fire, side by side).

The records are the eight chosen stage-6 materials (E21) grown from noise, which the home falls back
to, and every material the owner marked featured in the gallery's index. The home
picks among the featured ones that have a record. A featured material without a research run folder
(grown in a browser), or one that did not fire, gets no record; the script says why. So does a fallback
material the owner purged or hid: the home plays only what the index lists. Run it before each deploy
and commit what it writes; it deletes the strips of records it no longer writes.

Inputs: the gallery Worker that serves the index and the material files (GET only), the research run
folders with their readouts (stage 6 in the research repository; selection-margin runs in the
evidence archive), the public library (strongest-blocks files and the public cloud sample) and the
local Atlas records.

Usage: python engine/tools/prepare_training_demonstration.py --research <checkout> --margin-runs <runs> --atlas <atlas-clouds>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct
import urllib.request

import numpy as np
from PIL import Image

from prepare_atlas import POINT_DTYPE, RELEASE, SOURCE, principal_axes

# The home's fallback, one material per block: grown from noise, a picture with no face or text, a
# texture that tiles.
STORY_MATERIALS = [
    "block-2568-stage-6-pyramid-strongest-seed-1",
    "block-4009-stage-6-2px-2000-strongest-seed-0",
    "block-12002-stage-6-pyramid-strongest-seed-0",
    "block-12240-stage-6-noise-strongest-seed-0",
    "block-13345-stage-6-pyramid-strongest-seed-0",
    "block-13364-stage-6-pyramid-strongest-seed-0",
    "block-14544-stage-6-noise-strongest-seed-0",
    "block-16250-stage-6-noise-strongest-seed-0",
]
LIBRARY = "https://library.computervision.vision"
STRONGEST_BLOCKS = SOURCE.removesuffix("/clouds") + "/strongest-blocks"
# recipe.source of a selection-margin material; the runs are kept in the evidence archive.
MARGIN_RUNS = "research/2026-10-26-selection-margin/out"
# The CDN refuses Python's default user agent.
USER_AGENT = {"User-Agent": "dinodreamer-prepare-home-story/1"}
# The readouts picture the grid at this tick; the materials' readings are at the same tick.
READ_TICK = 600
# grow/figure-recipe.ts: a reading fires when the block wins on at least 90 % of the patches.
FIRE_WINNER_FRACTION = 0.9
# The prefix tokens before the 256 patches: CLS and four registers.
PATCH_SLOT_OFFSET = 5
# The Atlas record's points are float16; a plane that reproduces them is the record's plane.
PLANE_TOLERANCE = 0.01
# At most this many readouts per strip, evenly spaced, the first and the fire always kept: a visit
# loads one strip, and the noisy early frames barely compress (about 3.0 MB for all frames).
MAX_FRAMES = 16


def read_json(url: str) -> dict:
    request = urllib.request.Request(url, headers=USER_AGENT)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def atlas_points(record: bytes) -> np.ndarray:
    """The record's drawn points as [N, 2] (decodeAtlasCloud in app/src/library/atlas-cloud.ts)."""
    count = struct.unpack_from("<H", record, 8)[0]
    points_N = np.frombuffer(record, dtype=POINT_DTYPE, count=count, offset=60)
    return np.stack([points_N["x"].astype(np.float64), points_N["y"].astype(np.float64)], axis=1)


def anchor_place(block: int, image_id: int, slot: int, record: bytes) -> dict:
    """The anchor patch's place in the block's Atlas plane (atlasPoint), checked against the record's
    points, and the plane's two axes in code units (atlasPlane), so a page can land other codes in it."""
    sample = read_json(f"{LIBRARY}/{SOURCE}/{block}.json")
    summary = read_json(f"{LIBRARY}/{SOURCE}/summaries/{block}.json")
    codes_NR = np.asarray([row["code"] for row in sample["rows"]], dtype=np.float64)
    # prepare_atlas orients PC1 toward the main lobe of its own summary; the public summary has the
    # mean direction instead, and the check below proves the plane is the record's.
    axes_R2 = principal_axes(codes_NR, np.asarray(summary["mean_direction"], dtype=np.float64))
    plane_ND = codes_NR @ axes_R2
    drawn_ND = atlas_points(record)
    misfit = max(np.abs(plane_ND - point_D).max(axis=1).min() for point_D in drawn_ND)
    if misfit > PLANE_TOLERANCE:
        raise ValueError(f"Block {block}: the public sample's plane misses the Atlas points by {misfit:.4f}")
    rows = [index for index, row in enumerate(sample["rows"]) if row["image_id"] == image_id and row["slot"] == slot]
    if len(rows) != 1:
        raise ValueError(f"Block {block}: the anchor is not one row of the public sample")
    return {
        "atlasPoint": [round(float(value), 4) for value in plane_ND[rows[0]]],
        "atlasPlane": [[round(float(value), 6) for value in axes_R2[:, axis]] for axis in range(2)],
    }


def run_folder(source: str, research: Path, margin_runs: Path) -> tuple[Path, Path]:
    """The local run folder of the rule file that recipe.source names, and the run's research path.
    recipe.source: research/<study>/out/<...>/<run>/rules/update-NNNN.pt, or <run>/rule.pt."""
    rule_path = Path(source)
    run_path = rule_path.parent.parent if rule_path.parent.name == "rules" else rule_path.parent
    if source.startswith(f"{MARGIN_RUNS}/"):
        return margin_runs / run_path.relative_to(MARGIN_RUNS), run_path
    return research / run_path, run_path


def readout_reading(readout: dict, centre: bool) -> tuple[float, float]:
    """A readout's winner fraction and strength at READ_TICK. Stage 6 keys the tick "tick_600" and
    names the central patches' reading "centre_..."; selection-margin runs key it "ticks" -> "600",
    with f and the strength already over the run's scored patches."""
    if "ticks" in readout:
        tick = readout["ticks"][str(READ_TICK)]
        return tick["f"], tick["median_norm_over_m"]
    tick = readout[f"tick_{READ_TICK}"]
    prefix = "centre_" if centre else ""
    return tick[f"{prefix}winner"], tick[f"{prefix}median_norm_over_m"]


def training_frames(run: Path, first_fire: int, reading: dict) -> list[dict]:
    """Every readout up to the first fire, which must be the material's own reading."""
    readouts = json.loads((run / "readouts.json").read_text())
    centre = reading.get("region") == "centre-4x4"
    frames = []
    for readout in readouts:
        if readout["updates"] > first_fire:
            continue
        winner_fraction, strength = readout_reading(readout, centre)
        frames.append({"update": readout["updates"], "winnerFraction": round(winner_fraction, 4), "strength": round(strength, 4)})
    last = frames[-1]
    if last["update"] != first_fire or last["winnerFraction"] < FIRE_WINNER_FRACTION:
        raise ValueError(f"{run.name}: the last readout is not the fire at update {first_fire}")
    if any(frame["winnerFraction"] >= FIRE_WINNER_FRACTION for frame in frames[:-1]):
        raise ValueError(f"{run.name}: an earlier readout already fired")
    if abs(last["strength"] - reading["strength"]) > 1e-3 or abs(last["winnerFraction"] - reading["winnerFraction"]) > 1e-3:
        raise ValueError(f"{run.name}: the readout at update {first_fire} is not the material's reading")
    kept = sorted({round(index * (len(frames) - 1) / (MAX_FRAMES - 1)) for index in range(MAX_FRAMES)})
    return [frames[index] for index in kept]


def write_strip(run: Path, frames: list[dict], path: Path) -> int:
    """The frames side by side, as the trainer saved them, in lossless WebP; returns the frame side in pixels."""
    pictures = [Image.open(run / "readouts" / f"update-{frame['update']:04d}-tick-{READ_TICK:04d}.png").convert("RGB") for frame in frames]
    side = pictures[0].width
    if any(picture.size != (side, side) for picture in pictures):
        raise ValueError(f"{run.name}: the readouts differ in size")
    strip = Image.new("RGB", (side * len(pictures), side))
    for index, picture in enumerate(pictures):
        strip.paste(picture, (index * side, 0))
    strip.save(path, "WEBP", lossless=True, method=6)
    return side


def prepare_record(material_id: str, gallery: str, research: Path, margin_runs: Path, atlas: Path, output: Path) -> dict:
    material = read_json(f"{gallery}/api/materials/{material_id}/material.json")
    block, anchor, reading = material["block"], material["anchor"], material["reading"]
    if anchor["source"] != "library" or anchor.get("publicPreview") is False:
        raise ValueError(f"{material_id}: the anchor is not a public library picture")
    if reading["winnerFraction"] < FIRE_WINNER_FRACTION:
        raise ValueError(f"{material_id}: the material did not fire")
    run, run_path = run_folder(material["recipe"]["source"], research, margin_runs)
    if not (run / "readouts.json").is_file():
        raise ValueError(f"{material_id}: no research run folder with readouts at {run}")
    first_fire = material["training"]["updates"]
    frames = training_frames(run, first_fire, reading)

    strongest = read_json(f"{LIBRARY}/{STRONGEST_BLOCKS}/{anchor['imageId']}.json")
    cell = anchor["slot"] - PATCH_SLOT_OFFSET
    if not any(entry["block"] == block and cell in entry["cells"] for entry in strongest["blocks"]):
        raise ValueError(f"{material_id}: the picture's strongest blocks do not fire block {block} on the anchor patch")

    record = (atlas / "blocks" / f"{block}.bin").read_bytes()
    strip_name = f"{material_id}-training.webp"
    frame_side = write_strip(run, frames, output / strip_name)
    return {
        "material": material_id,
        "block": block,
        "anchor": {
            "imageId": anchor["imageId"],
            "slot": anchor["slot"],
            "band": anchor["band"],
            **anchor_place(block, anchor["imageId"], anchor["slot"], record),
        },
        "training": {
            "strip": strip_name,
            "frameSide": frame_side,
            "tick": READ_TICK,
            "medianNorm": material["recipe"]["settings"]["medianNorm"],
            "frames": frames,
        },
        "run": str(run_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    root = Path(__file__).resolve().parents[2]
    parser.add_argument("--gallery", default="http://127.0.0.1:8791", help="a gallery Worker that serves the material files")
    parser.add_argument("--research", type=Path, required=True, help="the research repository")
    parser.add_argument("--margin-runs", type=Path, required=True,
                        help="the evidence archive's copy of selection-margin runs")
    parser.add_argument("--atlas", type=Path, required=True, help="the local atlas-clouds folder (ATLAS_ASSETS/.../atlas-clouds)")
    parser.add_argument("--output", type=Path, default=root / "app" / "public" / "story")
    arguments = parser.parse_args()
    manifest = json.loads((arguments.atlas / "manifest.json").read_text())
    if manifest["release"] != RELEASE:
        raise ValueError(f"The Atlas records are of release {manifest['release']}, not {RELEASE}")
    arguments.output.mkdir(parents=True, exist_ok=True)
    folders = (arguments.research, arguments.margin_runs, arguments.atlas, arguments.output)
    entries = read_json(f"{arguments.gallery}/api/materials")["entries"]
    listed = {entry["id"] for entry in entries}
    records = []
    for material_id in STORY_MATERIALS:
        if material_id not in listed:
            print(json.dumps({"material": material_id, "noRecord": "the gallery no longer lists it (purged or hidden)"}), flush=True)
            continue
        records.append(prepare_record(material_id, arguments.gallery, *folders))
        print(json.dumps({"material": material_id, "frames": len(records[-1]["training"]["frames"])}), flush=True)
    # The featured set: a material that cannot have a record is reported and left out, not an error.
    featured = [entry["id"] for entry in entries if entry.get("featured") is True and entry["id"] not in STORY_MATERIALS]
    for material_id in featured:
        try:
            records.append(prepare_record(material_id, arguments.gallery, *folders))
            print(json.dumps({"material": material_id, "featured": True, "frames": len(records[-1]["training"]["frames"])}), flush=True)
        except ValueError as error:
            print(json.dumps({"material": material_id, "featured": True, "noRecord": str(error)}), flush=True)
    story = {"format": 1, "release": RELEASE, "atlasDomain": manifest["domain"], "records": records}
    temporary = arguments.output / "training-demonstration.pending.json"
    temporary.write_text(json.dumps(story, indent=1) + "\n")
    temporary.replace(arguments.output / "story.json")
    strips = {record["training"]["strip"] for record in records}
    for strip in arguments.output.glob("*-training.webp"):
        if strip.name not in strips:
            strip.unlink()
            print(json.dumps({"deleted": strip.name}), flush=True)


if __name__ == "__main__":
    main()
