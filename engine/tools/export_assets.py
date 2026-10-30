"""Export a pinned encoder and three selected bank targets to browser-sized files.

This offline tool uses PyTorch. The browser engine does not depend on Python.
"""

import argparse
import hashlib
import json
import shutil
from pathlib import Path
import torch
from safetensors.torch import load_file, save_file

ENCODER_SHA256 = "1b062798bd2f4cca0267be615465fdbc9df868d676632733ec547fc8e48044fa"
SOURCE_REVISION = "94a96ac83c2446f15f9bdcfae23cad3c6a9d4988"


def export(encoder: Path, bundle: Path, examples: Path, output: Path):
    checkpoint_bytes = encoder.read_bytes()
    if hashlib.sha256(checkpoint_bytes).hexdigest() != ENCODER_SHA256:
        raise ValueError("Use the pinned converted DINOv3 encoder checkpoint")
    del checkpoint_bytes
    state = load_file(encoder)
    record = json.loads((bundle / "model.json").read_text())
    if (
        record["code_convention"] != "gain-free-projection"
        or record["source"]["completed_steps"] != 98304
    ):
        raise ValueError("This export expects the released pass-3 native BSF")
    frames = load_file(bundle / "weights.safetensors")["frames"]
    calibration = load_file(bundle / "calibration.safetensors")
    selection = json.loads((examples / "examples.json").read_text())
    output.mkdir(parents=True, exist_ok=True)

    def save(name, tensors):
        save_file(
            {key: tensor.float().contiguous() for key, tensor in tensors.items()},
            output / name,
        )
        return {"path": name, "bytes": (output / name).stat().st_size}

    # Exactly the checkpoint's BF16 period values, promoted by FP32 coordinates.
    coords = torch.stack(
        torch.meshgrid(
            torch.arange(0.5, 16) / 16, torch.arange(0.5, 16) / 16, indexing="ij"
        ),
        dim=-1,
    ).flatten(0, 1)
    coords = 2.0 * coords - 1.0
    angles = (
        2 * torch.pi * coords[:, :, None] / state["rope_embed.periods"][None, None, :]
    )
    angles = angles.flatten(1, 2).tile(2)
    stem = {
        key: state[key]
        for key in (
            "cls_token",
            "storage_tokens",
            "patch_embed.proj.weight",
            "patch_embed.proj.bias",
            "norm.weight",
            "norm.bias",
        )
    }
    stem.update({"rope.sin": angles.sin(), "rope.cos": angles.cos()})
    encoder_files = [save("encoder-stem.safetensors", stem)]
    for layer in range(12):
        prefix = f"blocks.{layer}."
        block = {
            key[len(prefix) :]: value
            for key, value in state.items()
            if key.startswith(prefix)
        }
        # The checkpoint's k bias is masked by the upstream LinearKMaskedBias.
        block["attn.qkv.bias"] = block["attn.qkv.bias"] * block.pop(
            "attn.qkv.bias_mask"
        )
        encoder_files.append(save(f"encoder-layer-{layer:02d}.safetensors", block))
    targets = []
    for example in selection["examples"]:
        block = example["block"]
        entry = save(
            f"block-{block:05d}-target.safetensors",
            {
                "frame": frames[block],
                "mean": calibration["mean"],
                "scale": calibration["scale"].reshape(1),
                "code": torch.tensor(example["code"]),
            },
        )
        image = f"image-{example['image_id']}.png"
        shutil.copyfile(examples / image, output / image)
        targets.append(
            {
                **entry,
                **example,
                "image": image,
                "label": f"Block {block} · patch {example['position']}",
            }
        )
    manifest = {
        "format": 1,
        "image_size": 256,
        "encoder_revision": SOURCE_REVISION,
        "encoder_sha256": ENCODER_SHA256,
        "checkpoint": record["name"],
        "dictionary": record["files"]["weights.safetensors"]["sha256"],
        "calibration": record["files"]["calibration.safetensors"]["sha256"],
        "encoder": encoder_files,
        "targets": targets,
        "notice": "Local qualification assets. Do not publish before reviewing model and image rights.",
    }
    # A cache namespace changes when the small export contract changes. No
    # extra weight-file pass or opaque human-facing filenames are required.
    identity = hashlib.sha256(
        json.dumps(manifest, sort_keys=True).encode()
    ).hexdigest()[:16]
    manifest["id"] = f"dinov3-pass003-fp32-{identity}"
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        f"Exported {sum(item['bytes'] for item in encoder_files) / 2**20:.1f} MiB of encoder weights and {len(targets)} real targets"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encoder", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--examples", type=Path, default=Path("local/examples"))
    parser.add_argument("--output", type=Path, default=Path("public/assets/pass003"))
    args = parser.parse_args()
    export(args.encoder, args.bundle, args.examples, args.output)
