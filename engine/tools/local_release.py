"""Build and serve a local copy of the public release for the native harness and offline browser runs.

The harness examples (qualify, updates, painting_cost, explain_check, grow_recipe_parity,
grow_recipe_train, target_set_check) and the browser benchmarks read local/release/. Only the
model files and the example previews are present; the library tree comes from the bucket or
app/fixtures. Run from engine/:

    python tools/local_release.py build --bundle <pass-003 featurizer bundle>
    python tools/local_release.py serve            # http://127.0.0.1:8787, CORS for any origin

Inputs of build:
    --assets    the browser-sized encoder files that tools/export_assets.py writes
    --bundle    the pass-003 featurizer bundle: weights.safetensors (its frames) and
                calibration.safetensors (mean and scale)
    --examples  examples.json and its image-<id>.png previews (tools/fetch_examples.py)

Building needs NumPy and safetensors. Output goes to local/release/ (not in Git).
"""

import argparse
import hashlib
import json
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RELEASE = "pass-003"
ENCODER_ID = "dinov3-vitb16-pretrain-lvd1689m"
DICTIONARY_ID = "monet-dtd-seed9-20261004-pass-003"
PUBLICATION_ID = "5e2791a38795e8cc07b301307d137224d40d12a318547a038e49003ac29ed139"
ASSET_ID = "452ed7c3d3da3f1e26e5049db467eff46527627b37798e976d518b3da8105072"


def file_entry(root: Path, path: Path) -> dict:
    data = path.read_bytes()
    return {"path": str(path.relative_to(root)), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def build(assets: Path, bundle: Path, examples: Path, output: Path) -> None:
    import numpy as np  # Only building needs these; serving uses the standard library.
    from safetensors.numpy import load_file, save_file

    encoder = output / "model" / ENCODER_ID
    dictionary = output / "model" / DICTIONARY_ID
    (dictionary / "blocks").mkdir(parents=True, exist_ok=True)
    encoder.mkdir(parents=True, exist_ok=True)
    names = ["encoder-stem.safetensors"] + [f"encoder-layer-{layer:02d}.safetensors" for layer in range(12)]
    for name in names:
        if not (encoder / name).exists():
            shutil.copyfile(assets / name, encoder / name)
    calibration = load_file(bundle / "calibration.safetensors")
    save_file(
        {"mean": calibration["mean"].astype(np.float32), "scale": calibration["scale"].astype(np.float32).reshape(1)},
        dictionary / "calibration.safetensors",
    )
    frames_GDR = load_file(bundle / "weights.safetensors")["frames"].astype(np.float32)
    for block, frame_DR in enumerate(frames_GDR):
        save_file({"frame": np.ascontiguousarray(frame_DR)}, dictionary / "blocks" / f"{block:05d}.safetensors")
    previews = output / "web" / "v2" / "assets" / ASSET_ID / "previews"
    previews.mkdir(parents=True, exist_ok=True)
    for example in json.loads((examples / "examples.json").read_text())["examples"]:
        image_id = example["image_id"]
        shutil.copyfile(examples / f"image-{image_id}.png", previews / f"{image_id}.png")
    manifest = {
        "format": 1,
        "release": RELEASE,
        "library": {"publication_id": PUBLICATION_ID, "asset_id": ASSET_ID},
        "model": {
            "encoder": f"model/{ENCODER_ID}/",
            "dictionary": f"model/{DICTIONARY_ID}/",
            "files": [file_entry(output, encoder / name) for name in names]
            + [file_entry(output, dictionary / "calibration.safetensors")],
            "blocks": len(frames_GDR),
            "rank": frames_GDR.shape[2],
            "image_size": 256,
            "grid": 16,
        },
        "licenses": [],
        "notice": "Local copy for development. Not the public release.",
    }
    (output / "releases").mkdir(exist_ok=True)
    (output / "releases" / f"{RELEASE}.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {output} with {len(frames_GDR)} block frames")


class CorsHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "ETag")
        super().end_headers()


def serve(root: Path, port: int) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(CorsHandler, directory=str(root)))
    print(f"Serving {root} at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--assets", type=Path, default=Path("public/assets/pass003"))
    build_parser.add_argument("--bundle", type=Path, required=True)
    build_parser.add_argument("--examples", type=Path, default=Path("local/examples"))
    build_parser.add_argument("--output", type=Path, default=Path("local/release"))
    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--root", type=Path, default=Path("local/release"))
    serve_parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    if args.command == "build":
        build(args.assets, args.bundle, args.examples, args.output)
    else:
        serve(args.root, args.port)