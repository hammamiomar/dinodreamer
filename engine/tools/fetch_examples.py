"""Fetch three real pass-3 bank points and their exact previews. Read-only CPU job.

Run with Modal's CLI. No GPU, publication, bank scan or library copy is needed.
"""

import json
from pathlib import Path
import modal

app = modal.App("dinodreamer-browser-fixtures")
volume = modal.Volume.from_name("dinodreamer-native-runs", version=2)
RUN = "monet-dtd-seed9-20261004"
BLOCKS = (100, 1000, 10000)


@app.function(
    image=modal.Image.debian_slim().pip_install("pyarrow"),
    volumes={"/runs": volume.with_mount_options(read_only=True)},
    cpu=1,
    memory=2048,
    timeout=180,
    max_containers=1,
)
def fetch():
    import sqlite3
    import pyarrow.parquet as pq

    root = Path("/runs") / RUN / "banks"
    bank = root / "pass-003"
    connection = sqlite3.connect(f"file:{bank / 'catalog.sqlite'}?mode=ro", uri=True)
    examples = []
    with (bank / "blocks.pack").open("rb") as stream:
        for block in BLOCKS:
            offset, size = connection.execute(
                "SELECT offset, bytes FROM blocks WHERE block = ?", (block,)
            ).fetchone()
            stream.seek(offset)
            payload = json.loads(stream.read(size))
            point = next(
                point for point in payload["cloud"] if point["role"] == "patch"
            )
            examples.append({"block": block, **point})
    connection.close()
    assets = root / "assets-pass-003"
    ids = [example["image_id"] for example in examples]
    rows = pq.read_table(
        assets / "images.parquet",
        columns=[
            "image_id",
            "preview_pack",
            "preview_offset",
            "preview_bytes",
            "source",
            "license",
        ],
        filters=[("image_id", "in", ids)],
    ).to_pylist()
    previews = {}
    for row in rows:
        with (assets / row["preview_pack"]).open("rb") as stream:
            stream.seek(row["preview_offset"])
            previews[row["image_id"]] = stream.read(row["preview_bytes"])
        for example in examples:
            if example["image_id"] == row["image_id"]:
                example.update(source=row["source"], license=row["license"])
    return examples, previews


@app.local_entrypoint()
def main():
    examples, previews = fetch.remote()
    destination = Path(__file__).resolve().parents[1] / "local" / "examples"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "examples.json").write_text(
        json.dumps(
            {"run": RUN, "checkpoint": "pass-003", "examples": examples}, indent=2
        )
    )
    for image_id, pixels in previews.items():
        (destination / f"image-{image_id}.png").write_bytes(pixels)
    print(
        f"Saved {len(examples)} actual bank points and {len(previews)} previews to {destination}"
    )
