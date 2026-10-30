"""Prepare compact Atlas records once. Full cloud fixtures stay off the Atlas path."""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
import math
from pathlib import Path
import struct
import time

import numpy as np

SOURCE = "web/v2/readouts/5e2791a38795e8cc07b301307d137224d40d12a318547a038e49003ac29ed139/clouds"
ATLAS_PATH = SOURCE.removesuffix("/clouds") + "/atlas-clouds"
RELEASE = "pass-003"
POINT_LIMIT = 512
# Four pictures per band, so the rare strong bands show as many as Barely.
PICTURES_PER_BAND = 4
PICTURE_LIMIT = 4 * PICTURES_PER_BAND
# ATC1 records held twelve pictures allotted by band population.
RECORD_SIGNATURE = b"ATC2"
HEADER = struct.Struct("<4sHHHBBff4HIffff3f")
INDEX_ROW = struct.Struct("<HHfff4H")
PICTURE = struct.Struct("<QHB")
# S indexes the four strength bands. N indexes sampled patches; R is native rank 3.
POINT_DTYPE = np.dtype([("x", "<f2"), ("y", "<f2"), ("band", "u1")])


def allocate_examples(counts_S: np.ndarray, budget: int) -> np.ndarray:
    """Approximate patch shares with a fixed count; keep each occupied band visible."""
    if not counts_S.sum():
        return np.zeros(len(counts_S), dtype=np.int64)
    budget = min(budget, int(counts_S.sum()))
    quotas_S = counts_S / counts_S.sum() * budget
    assigned_S = np.where(counts_S > 0, np.maximum(1, np.floor(quotas_S)), 0).astype(
        np.int64
    )
    while assigned_S.sum() > budget:
        removable_S = np.where(assigned_S > 1, assigned_S - quotas_S, -np.inf)
        assigned_S[np.argmax(removable_S)] -= 1
    while assigned_S.sum() < budget:
        missing_S = np.where(assigned_S < counts_S, quotas_S - assigned_S, -np.inf)
        assigned_S[np.argmax(missing_S)] += 1
    return assigned_S


def strength_bands(norms_N: np.ndarray, ring: float) -> tuple[np.ndarray, np.ndarray]:
    """Quarter the distance from ring to maximum; inside-ring winners stay in barely."""
    maximum = float(norms_N.max()) if len(norms_N) else 0.0
    if maximum <= ring:
        return np.zeros(len(norms_N), dtype=np.int64), np.asarray(
            [len(norms_N), 0, 0, 0], dtype=np.int64
        )
    boundaries_S = ring + (maximum - ring) * np.arange(1, 4) / 4
    bands_N = np.searchsorted(boundaries_S, norms_N, side="right").clip(0, 3)
    return bands_N, np.bincount(bands_N, minlength=4)


def principal_axes(codes_NR: np.ndarray, direction_R: np.ndarray) -> np.ndarray:
    """R=3 native coordinates. The two axes of the origin-preserving PCA plane, [R, 2], with
    PC1 toward the main lobe; a code lands in the plane at codes_R @ axes_R2."""
    if len(codes_NR) < 2:
        return np.eye(codes_NR.shape[1])[:, :2]
    moment_RR = np.einsum("nr,ns->rs", codes_NR, codes_NR) / len(codes_NR)
    values_R, vectors_RR = np.linalg.eigh(moment_RR)
    axes_RR = vectors_RR[:, np.argsort(values_R)[::-1]]
    if axes_RR[:, 0] @ direction_R < 0:
        axes_RR[:, 0] *= -1
    if axes_RR[np.argmax(np.abs(axes_RR[:, 1])), 1] < 0:
        axes_RR[:, 1] *= -1
    return axes_RR[:, :2]


def principal_plane(codes_NR: np.ndarray, direction_R: np.ndarray) -> np.ndarray:
    """The codes in the plane of principal_axes, [N, 2]."""
    return codes_NR @ principal_axes(codes_NR, direction_R)


def choose_pictures(
    rows: list[dict], norms_N: np.ndarray, bands_N: np.ndarray, counts_S: np.ndarray
) -> list[tuple[int, int, int]]:
    """Four per band, or every patch of a smaller band, at within-band norm quantiles.

    Prefer distinct images across the four bands. The strongest band chooses first:
    a rare band has few alternatives, and Barely has thousands.
    """
    allocation_S = np.minimum(counts_S, PICTURES_PER_BAND)
    used: set[int] = set()
    chosen_by_band: list[list[tuple[int, int, int]]] = [[] for _ in allocation_S]
    for band in reversed(range(len(allocation_S))):
        wanted = int(allocation_S[band])
        members_N = np.flatnonzero(bands_N == band)
        members_N = members_N[np.argsort(norms_N[members_N], kind="stable")]
        for position in range(wanted):
            target = members_N[
                min(len(members_N) - 1, int((position + 0.5) * len(members_N) / wanted))
            ]
            candidates_N = members_N[
                np.argsort(np.abs(norms_N[members_N] - norms_N[target]), kind="stable")
            ]
            chosen = next(
                (
                    int(index)
                    for index in candidates_N
                    if rows[index]["image_id"] not in used
                ),
                int(target),
            )
            row = rows[chosen]
            used.add(row["image_id"])
            chosen_by_band[band].append((row["image_id"], row["slot"], band))
    # Stored barely first; inside a band, in quantile order from the weakest.
    return [picture for band in chosen_by_band for picture in band]


def pack_record(fixture: dict, summary: dict) -> bytes:
    """Validate source identity and numerical fields once, then pack a display-only record."""
    block = int(summary["block"])
    rows = fixture["rows"]
    if (
        fixture["format"] != 2
        or fixture["block"] != block
        or fixture["source"]["release"] != RELEASE
        or summary["release"] != RELEASE
    ):
        raise ValueError(f"Source identity differs for block {block}")
    if len(rows) > 4096 or len(rows) != summary["sample"]["rows"]:
        raise ValueError(f"Invalid sample size for block {block}")
    codes_NR = np.asarray([row["code"] for row in rows], dtype=np.float64).reshape(
        -1, 3
    )
    norms_N = np.asarray([row["norm"] for row in rows], dtype=np.float64)
    if (
        not np.isfinite(codes_NR).all()
        or not np.isfinite(norms_N).all()
        or not np.allclose(
            np.linalg.norm(codes_NR, axis=1), norms_N, rtol=1e-5, atol=1e-6
        )
    ):
        raise ValueError(f"Invalid native coordinates for block {block}")
    if any(
        not 0 < row["image_id"] <= 2**53 - 1
        or not 5 <= row["slot"] <= 260
        or not row["public_preview"]
        for row in rows
    ):
        raise ValueError(f"Invalid public patch address for block {block}")
    ring = float(summary["gate_median"] or 0)
    maximum = float(norms_N.max()) if len(rows) else 0.0
    bands_N, counts_S = strength_bands(norms_N, ring)
    direction_R = np.asarray(
        (summary.get("main_lobe") or {}).get("direction", [1, 0, 0]), dtype=np.float64
    )
    plane_ND = principal_plane(codes_NR, direction_R)  # D=2 displayed coordinates.
    allocation_S = allocate_examples(counts_S, POINT_LIMIT)
    generator = np.random.default_rng([20261021, block])
    selected = []
    for band, wanted in enumerate(allocation_S):
        members_N = np.flatnonzero(bands_N == band)
        if wanted:
            selected.extend(
                generator.choice(members_N, size=int(wanted), replace=False).tolist()
            )
    selected_N = np.asarray(sorted(selected), dtype=np.int64)
    # Retain the actual outermost winning patch so the lobe's end is not lost in thinning.
    if len(rows) and norms_N.argmax() not in selected_N:
        replace = np.flatnonzero(bands_N[selected_N] == bands_N[norms_N.argmax()])[-1]
        selected_N[replace] = norms_N.argmax()
    points_N = np.empty(len(selected_N), dtype=POINT_DTYPE)
    points_N["x"], points_N["y"] = plane_ND[selected_N].T
    points_N["band"] = bands_N[selected_N]
    if not np.isfinite(points_N["x"]).all() or not np.isfinite(points_N["y"]).all():
        raise ValueError(f"Projection exceeds float16 for block {block}")
    pictures = choose_pictures(rows, norms_N, bands_N, counts_S)
    pole = summary.get("pole") or {}
    reach = max(0.0, float(summary["radius"]["p95"] or 0) - ring)
    header = HEADER.pack(
        RECORD_SIGNATURE,
        block,
        len(rows),
        len(points_N),
        len(pictures),
        int(bool(pole.get("present"))),
        ring,
        maximum,
        *counts_S.tolist(),
        int(summary["patch_rows"]),
        float(summary["public_fraction"] or 0),
        reach,
        float(summary["near_gate_fraction"] or 0),
        float(pole.get("share") or 0) if pole.get("present") else 0.0,
        *(ring + max(0.0, maximum - ring) * step / 4 for step in (1, 2, 3)),
    )
    return (
        header
        + points_N.tobytes()
        + b"".join(PICTURE.pack(*picture) for picture in pictures)
    )


def inspect_record(data: bytes) -> dict:
    """Read a completed compact output, including on resume; never reopen its large source."""
    header = HEADER.unpack_from(data)
    signature, block, total, point_count, picture_count, flags, ring, maximum, *rest = (
        header
    )
    counts = rest[:4]
    wins, public, reach, near, pole = rest[4:9]
    if (
        signature != RECORD_SIGNATURE
        or len(data) != HEADER.size + point_count * 5 + picture_count * PICTURE.size
        or sum(counts) != total
    ):
        raise ValueError("Incomplete Atlas record")
    points_N = np.frombuffer(
        data, dtype=POINT_DTYPE, count=point_count, offset=HEADER.size
    )
    return {
        "block": block,
        "index": INDEX_ROW.pack(block, total, reach, near, pole, *counts),
        "counts": counts,
        "total": total,
        "bytes": len(data),
        "extent": [
            float(points_N["x"].min()),
            float(points_N["x"].max()),
            float(np.abs(points_N["y"]).max()),
        ]
        if point_count
        else [0, 0, 0],
    }


def prepare_block(arguments: tuple[str, str, int]) -> dict:
    source_name, output_name, block = arguments
    source, output = Path(source_name), Path(output_name)
    target = output / "blocks" / f"{block}.bin"
    if target.exists():
        return {
            **inspect_record(target.read_bytes()),
            "source_bytes": 0,
            "resumed": True,
        }
    summary_path = source / "summaries" / f"block-{block}.json"
    fixture_path = source / "blocks" / f"block-{block}.json"
    summary_bytes = summary_path.read_bytes()
    summary = json.loads(summary_bytes)
    fixture_bytes = fixture_path.read_bytes() if summary["sample"]["rows"] else b""
    fixture = (
        json.loads(fixture_bytes)
        if fixture_bytes
        else {"format": 2, "block": block, "source": {"release": RELEASE}, "rows": []}
    )
    data = pack_record(fixture, summary)
    temporary = target.with_suffix(".pending")
    temporary.write_bytes(data)
    temporary.replace(target)
    return {
        **inspect_record(data),
        "source_bytes": len(summary_bytes) + len(fixture_bytes),
        "resumed": False,
    }


def prepare_atlas(
    source: Path, output: Path, blocks: list[int], workers: int = 4
) -> dict:
    started = time.monotonic()
    (output / "blocks").mkdir(parents=True, exist_ok=True)
    arguments = [(str(source), str(output), block) for block in blocks]
    records = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for record in pool.map(prepare_block, arguments, chunksize=8):
            records.append(record)
            if len(records) % 512 == 0:
                print(
                    json.dumps(
                        {
                            "prepared": len(records),
                            "of": len(blocks),
                            "seconds": round(time.monotonic() - started, 1),
                        }
                    ),
                    flush=True,
                )
    records.sort(key=lambda record: record["block"])
    index = struct.pack("<4sHH", b"ATI1", len(records), INDEX_ROW.size) + b"".join(
        record["index"] for record in records
    )
    (output / "index.bin").write_bytes(index)
    sparse = [
        record["block"]
        for record in records
        if record["total"] and record["counts"][3] < 5
    ]
    manifest = {
        "format": 1,
        "release": RELEASE,
        "source": SOURCE,
        "blocks": len(records),
        "pointLimit": POINT_LIMIT,
        "pictureLimit": PICTURE_LIMIT,
        "index": "index.bin",
        "records": "blocks",
        "domain": {
            "xMin": math.floor(min(record["extent"][0] for record in records) / 5) * 5,
            "xMax": math.ceil(max(record["extent"][1] for record in records) / 5) * 5,
            "yMaximum": math.ceil(max(record["extent"][2] for record in records) / 5)
            * 5,
        },
        "bandRule": "Quarter the distance from median ring to sample maximum; inside-ring winners stay in barely.",
        "glyphRule": "Uncentred principal plane; PC1 toward main lobe; proportional band thinning with seed [20261021, block], retaining strongest point. Float16 is for display only.",
        "pictureRule": "Four per band, or every patch of a smaller band; norm quantiles within each band, preferring distinct image IDs, the strongest band choosing first.",
        "recordBytes": sum(record["bytes"] for record in records),
        "maximumRecordBytes": max(record["bytes"] for record in records),
        "indexBytes": len(index),
        "strongestBelowFive": {
            "blocks": sparse,
            "count": len(sparse),
            "nonemptyBlocks": sum(record["total"] > 0 for record in records),
        },
    }
    temporary = output / "manifest.pending.json"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(output / "manifest.json")
    report = {
        "blocks": len(records),
        "recordBytes": manifest["recordBytes"],
        "indexBytes": len(index),
        "maximumRecordBytes": manifest["maximumRecordBytes"],
        "strongestBelowFive": len(sparse),
        "nonemptyBlocks": manifest["strongestBelowFive"]["nonemptyBlocks"],
        "domain": manifest["domain"],
        "sourceBytesRead": sum(record["source_bytes"] for record in records),
        "resumedRecords": sum(record["resumed"] for record in records),
        "seconds": round(time.monotonic() - started, 2),
    }
    (output / "preparation.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def annotate_materials(output: Path, palette: Path) -> None:
    """Attach the Studio's current saved-rule status without rereading cloud sources."""
    materials: dict[int, set[str]] = {}
    for name in json.loads(palette.read_text()):
        material = json.loads((palette.parent / name).read_text())
        mode = material["mode"]
        if mode not in ("fill", "plant"):
            raise ValueError(f"Unknown material mode: {mode}")
        materials.setdefault(material["block"], set()).add(mode)
    path = output / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest["materials"] = [
        {"block": block, "modes": sorted(modes)}
        for block, modes in sorted(materials.items())
    ]
    temporary = path.with_suffix(".pending")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Prepare compact cloud records")
    prepare.add_argument("source", type=Path)
    prepare.add_argument("output", type=Path)
    prepare.add_argument("--blocks", default=",".join(map(str, range(16384))))
    prepare.add_argument("--workers", type=int, default=4)
    materials = commands.add_parser(
        "materials", help="Refresh saved material status only"
    )
    materials.add_argument("output", type=Path)
    materials.add_argument("palette", type=Path)
    args = parser.parse_args()
    if args.command == "materials":
        annotate_materials(args.output, args.palette)
    else:
        report = prepare_atlas(
            args.source,
            args.output,
            [int(block) for block in args.blocks.split(",")],
            args.workers,
        )
        print(json.dumps(report, indent=2))
