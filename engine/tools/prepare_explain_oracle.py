"""CPU oracle for the /how explorables' engine exports (engine/src/web/explain.rs): one picture
through the frozen DINOv3 and BSF in the research environment.

It records, for one 256 x 256 picture: the residual stream entering and leaving one layer, that
layer's softmax attention weights for a few query tokens, and the output tokens (every 97th value
of each); the gate of two tokens (winners, gain-free codes, norms and the token rebuilt by
bsf.py's decode(encode(x))); and three blocks' frames. The attention weights are computed
explicitly from the layer's own modules, then checked: their output, through the layer's
projection, residual scale and MLP, must give the layer's real output within 1e-5.
`examples/explain_check.rs` compares the engine against the record.

Usage: python engine/tools/prepare_explain_oracle.py --research <checkout> --dino-source <source> --dino-weights <checkpoint> --bundle <bundle> --picture <picture.png> --output <fixture.json>

Axes: T = 261 tokens (class, four registers, 16 x 16 patches), D = 768, H = 12 heads,
E = 64 channels per head, K = 32 winners, R = 3.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

ARCHIVE_SHA256 = "5c10352e424989e1f423b8fa05745127e922ae3b98ab4410fea79225da516bdf"
SAMPLE = 97  # every 97th value: 97 shares no factor with 768 or 261, so every channel and token is sampled
QUERIES = (0, 5, 140, 260)  # the class token, the first patch, a central patch, the last patch
GATE_TOKENS = (5, 140)


def encode(values) -> str:
    return base64.b64encode(np.ascontiguousarray(np.asarray(values), dtype="<f4").tobytes()).decode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--picture", type=Path, required=True, help="a 256 x 256 picture")
    parser.add_argument("--layer", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--research", type=Path, required=True, help="Research checkout containing src and the archived objective-dynamics study")
    parser.add_argument("--dino-source", type=Path, required=True, help="DINOv3 source checkout")
    parser.add_argument("--dino-weights", type=Path, required=True, help="DINOv3 checkpoint")
    parser.add_argument("--bundle", type=Path, required=True, help="BSF bundle containing bsf.py and its weights")
    args = parser.parse_args()
    torch.set_num_threads(8)

    objective_dynamics = args.research / "research/2026-10-22-objective-dynamics"
    archive = objective_dynamics / "original_recipe.py"
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("original_recipe.py is not the archived trainer")
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(args.bundle.resolve()), str((args.research / "src").resolve()), str(objective_dynamics.resolve())]
    # Load the selected bundle before the archived module adds its historical search paths.
    __import__("bsf")
    import original_recipe as original  # noqa: E402

    device = torch.device("cpu")
    dino = original.load_dinov3(args.dino_source, args.dino_weights, device)
    model = original.bsf.load_bundle(args.bundle, device)

    picture = Image.open(args.picture).convert("RGB")
    if picture.size != (256, 256):
        raise SystemExit("The exports read a 256 x 256 picture")
    rgb_HWC = np.array(picture)
    rgb_13HW = torch.from_numpy(rgb_HWC).permute(2, 0, 1).unsqueeze(0).float() / 255

    vit = dino.model
    block = vit.blocks[args.layer]
    captured = {}

    def keep(_module, inputs, output):
        first = lambda value: value[0] if isinstance(value, (list, tuple)) else value  # noqa: E731
        captured["before"] = first(inputs[0]).detach().clone()
        captured["after"] = first(output).detach().clone()

    handle = block.register_forward_hook(keep)
    with torch.no_grad():
        native_1TD = dino.native_tokens(rgb_13HW)
    handle.remove()
    before_1TD, after_1TD = captured["before"], captured["after"]

    # The layer's attention, explicitly, from its own modules (dinov3/layers/attention.py).
    with torch.no_grad():
        attention = block.attn
        sin_PE, cos_PE = vit.rope_embed(H=16, W=16)
        qkv_1T3HE = attention.qkv(block.norm1(before_1TD)).reshape(1, 261, 3, attention.num_heads, -1)
        queries_1HTE, keys_1HTE, values_1HTE = [part.transpose(1, 2) for part in torch.unbind(qkv_1T3HE, 2)]
        queries_1HTE, keys_1HTE = attention.apply_rope(queries_1HTE, keys_1HTE, (sin_PE, cos_PE))
        weights_1HTT = torch.softmax(queries_1HTE @ keys_1HTE.transpose(-2, -1) * attention.scale, dim=-1)
        attended_1TD = (weights_1HTT @ values_1HTE).transpose(1, 2).reshape(1, 261, 768)
        middle_1TD = before_1TD + block.ls1(attention.proj(attended_1TD))
        rebuilt_1TD = middle_1TD + block.ls2(block.mlp(block.norm2(middle_1TD)))
    check = float((rebuilt_1TD - after_1TD).norm() / after_1TD.norm())
    if check > 1e-5:
        raise SystemExit(f"The explicit attention does not rebuild the layer's output (relative error {check})")

    gates = []
    with torch.no_grad():
        for token in GATE_TOKENS:
            native_D = native_1TD[0, token]
            calibrated_1D = model.calibrate(native_D[None])
            codes = model.codes(calibrated_1D)
            reconstruction_1D = model.decode(model.encode(calibrated_1D))
            gates.append({
                "token": token,
                "native": encode(native_D),
                "calibrated": encode(calibrated_1D[0]),
                "blocks": codes.ids_NK[0].tolist(),
                "codes": encode(codes.values_NKR[0].flatten()),
                "norms": encode(codes.values_NKR[0].norm(dim=-1)),
                "reconstruction": encode(reconstruction_1D[0]),
                "residual": float((calibrated_1D - reconstruction_1D).norm() / calibrated_1D.norm()),
            })
    frame_blocks = sorted({gates[0]["blocks"][0], gates[1]["blocks"][0], 12002})
    frames = [{"block": block_id, "directions": encode(model.frames_GDR[block_id].T.flatten())} for block_id in frame_blocks]

    fixture = {
        "format": 1,
        "purpose": "The /how explorables' exports: one picture through DINOv3 and the BSF on CPU (tools/prepare_explain_oracle.py).",
        "picture": {"path": args.picture.name, "sha256": hashlib.sha256(args.picture.read_bytes()).hexdigest(),
                    "rgb": base64.b64encode(rgb_HWC.astype(np.uint8).tobytes()).decode()},
        "layer": args.layer,
        "sample": SAMPLE,
        "probe": {
            "before": encode(before_1TD.flatten()[::SAMPLE]),
            "after": encode(after_1TD.flatten()[::SAMPLE]),
            "final": encode(native_1TD.flatten()[::SAMPLE]),
            "queries": list(QUERIES),
            "attention": encode(weights_1HTT[0][:, list(QUERIES), :].flatten()),
            "rebuildCheck": check,
        },
        "gain": float(model.gain),
        "scale": float(model.scale),
        "gates": gates,
        "frames": frames,
        "provenance": {
            "archiveSha256": ARCHIVE_SHA256,
            "oracleSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            # The bundle folder's name, not its absolute path: the record is published.
            "bundle": args.bundle.name,
            "torch": torch.__version__,
            "device": "cpu",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture) + "\n")
    print(json.dumps({"output": str(args.output), "rebuildCheck": check, "gain": fixture["gain"],
                      "winners": [gate["blocks"][:3] for gate in gates], "residuals": [gate["residual"] for gate in gates]}))


if __name__ == "__main__":
    main()
