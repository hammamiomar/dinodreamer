"""Record /how's numbers for selected library pictures once (CPU only).

/how (app/src/features/how/) draws DINO and the BSF on a picture. With WebGPU the browser computes
every number with the engine (encode_probe, gate, frame). Without it, or before the person starts the
engine, the page shows these recorded numbers for four of its twelve pictures. Each picture's folder
in app/public/how/recorded/ holds:

    record.json         the picture, its anchor patch and block, the provenance, and per-token norms
                        of every stage and update sizes of every layer (the twelve-layer overview)
    stream-00..12.bin   the residual stream entering layer 1 (00) and leaving layer k (k), 261 × 768
    attention-01..12    layer k's attention, the mean over its 12 heads, 261 × 261 (query × key)
    final.bin           the tokens after the final LayerNorm, 261 × 768, float16: the reader's input
    addresses.bin       each patch's 32 winning blocks with gain-free codes, as read_image returns them

Formats (little-endian), decoded by app/src/features/how/recorded.ts:

    stream    "HST1", u16 tokens, u16 width, f32 range M, u32 outliers n; i8 q[tokens·width] (μ-law,
              μ = 255: v = sign(q)·M/μ·((1 + μ)^(|q|/127) − 1)); u32 index[n]; f32 value[n] (the values
              with |v| > M, exact). M is the stage's 99.9th percentile of |v|; DINOv3 carries values up
              to about 9,300 in two channels of a few tokens from layer 4 on, which a
              per-token linear scale would let swamp the rest. A step is about 4 % of the value.
    attention "HAT1", u16 tokens, u16 pad; u8 q[tokens·tokens]: a = (q / 255)², rows sum to about 1.
    final     "HFN1", u16 tokens, u16 width; f16 v[tokens·width].
    addresses "HAD1", u16 patches, u16 winners; u16 blocks[256·32], f32 codes[256·32·3], f32 norms[256·32].

The encoder is Meta's DINOv3 ViT-B/16 checkpoint (dinov3_vitb16_pretrain_lvd1689m-73cec8be.pth, equal
to the exported encoder files) in the pinned dinov3 source; the
dictionary is the published Hugging Face export (dictionary.safetensors: frames, calibration_mean,
calibration_scale, gain). The engine computes the same numbers in FP32 on WebGPU; the two agree to
FP32 rounding, far below the stored precision.

Usage: python engine/tools/prepare_how_records.py --dino-source <source> --encoder <checkpoint> --dictionary <dictionary.safetensors>

Use --picture 2985056820452196 to prepare only the default picture. Use --encoder to read the
pinned checkpoint from another local path, including its lossless safetensors conversion.
"""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import importlib
import json
from pathlib import Path
import struct
import sys
import urllib.request

import numpy as np
import torch
from einops import einsum, rearrange
from PIL import Image
from safetensors import safe_open
from safetensors.torch import load_file

# Each recorded picture is the anchor of a published material grown from noise. Group 4009 is the
# default. Its published material has two pixels per cell; this recording describes the
# source picture, not the material's training run.
RECORDED = [
    {"imageId": 2985056820452196, "slot": 59, "block": 4009, "material": "block-4009-stage-6-2px-2000-strongest-seed-0"},
    {"imageId": 7458416253439473, "slot": 114, "block": 14544, "material": "block-14544-stage-6-noise-strongest-seed-0"},
    {"imageId": 3659045719526781, "slot": 109, "block": 12240, "material": "block-12240-stage-6-noise-strongest-seed-0"},
    {"imageId": 3358357912530755, "slot": 62, "block": 13364, "material": "block-13364-stage-6-noise-strongest-seed-0"},
]
LIBRARY = "https://library.computervision.vision"
ASSET_ID = "452ed7c3d3da3f1e26e5049db467eff46527627b37798e976d518b3da8105072"
GALLERY = "http://127.0.0.1:8791"
# The CDN refuses Python's default user agent.
USER_AGENT = {"User-Agent": "dinodreamer-prepare-how-records/1"}

DINOV3_REVISION = "94a96ac83c2446f15f9bdcfae23cad3c6a9d4988"
ENCODER_SHA256 = {
    ".pth": "73cec8be7427c8655ceced13ce62f6e20a1fa90d1b4d4a550df17a1144081a7c",
    ".safetensors": "1b062798bd2f4cca0267be615465fdbc9df868d676632733ec547fc8e48044fa",
}
OUTPUT = Path(__file__).resolve().parents[2] / "app/public/how/recorded"

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
PREFIX = 5
PATCHES = 256
TOKENS = PREFIX + PATCHES
WIDTH = 768
HEADS = 12
HEAD_WIDTH = 64
WINNERS = 32
MU = 255.0
# The stream's μ-law range: the stage's 99.9th percentile of |v|; larger values are stored exactly.
RANGE_QUANTILE = 0.999
# A recorded code must equal the material's anchor code (the library's own record) within this share
# of its norm. The bank encoded each picture's FP32 resized view; the page, like read_image, reads the
# published 8-bit PNG of that view, which moves a code by up to about 0.5 % (0.53 % on 3659045719526781).
ANCHOR_TOLERANCE = 0.01


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers=USER_AGENT)
    with urllib.request.urlopen(request) as response:
        return response.read()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def load_encoder(source: Path, checkpoint: Path) -> torch.nn.Module:
    revision = (source / ".git").exists() and __import__("subprocess").check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    if revision != DINOV3_REVISION:
        raise SystemExit(f"dinov3 source is at {revision}, pinned revision is {DINOV3_REVISION}")
    sys.path.insert(0, str(source))
    backbones = importlib.import_module("dinov3.hub.backbones")
    with torch.device("meta"):
        model = backbones.dinov3_vitb16(pretrained=False, device="meta")
    if checkpoint.suffix == ".safetensors":
        state = load_file(checkpoint, device="cpu")
    else:
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True, assign=True)
    torch.backends.fp32_precision = "ieee"
    return model.eval()


def picture_rgb(image_id: int) -> torch.Tensor:
    """The library's prepared 256 × 256 view, decoded without colour management, as read_image reads it."""
    png = fetch(f"{LIBRARY}/web/v2/assets/{ASSET_ID}/previews/{image_id}.png")
    from io import BytesIO

    rgb_HWC = np.asarray(Image.open(BytesIO(png)).convert("RGB"), dtype=np.float32) / 255
    if rgb_HWC.shape != (256, 256, 3):
        raise SystemExit(f"picture {image_id} is not 256 × 256")
    return rearrange(torch.from_numpy(rgb_HWC), "h w c -> 1 c h w")


def picture_rgb_file(path: Path) -> torch.Tensor:
    """A 256 × 256 PNG on disk, decoded as the library's views are."""
    rgb_HWC = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255
    if rgb_HWC.shape != (256, 256, 3):
        raise SystemExit(f"{path} is not 256 × 256")
    return rearrange(torch.from_numpy(rgb_HWC), "h w c -> 1 c h w")


@torch.no_grad()
def probe(model: torch.nn.Module, rgb_1CHW: torch.Tensor) -> tuple[list[torch.Tensor], list[torch.Tensor], torch.Tensor]:
    """The residual stream at every depth [13 × T × D], each layer's attention [12 × H × T × T], the final tokens."""
    mean = torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(1, 3, 1, 1)
    tokens_1TD, (rows, columns) = model.prepare_tokens_with_masks((rgb_1CHW - mean) / std)
    rope = model.rope_embed(H=rows, W=columns)
    streams = [tokens_1TD[0]]
    attentions = []
    for block in model.blocks:
        # The same q and k (with RoPE) and softmax as the block's fused attention, written out so the
        # weights can be kept; the check below compares weights × values with the block's own output.
        attention = block.attn
        qkv_1T3HE = rearrange(attention.qkv(block.norm1(tokens_1TD)), "b t (three h e) -> b t three h e", three=3, h=HEADS)
        queries_1HTE, keys_1HTE, values_1HTE = (rearrange(qkv_1T3HE[:, :, index], "b t h e -> b h t e") for index in range(3))
        queries_1HTE, keys_1HTE = attention.apply_rope(queries_1HTE, keys_1HTE, rope)
        scores_1HTT = einsum(queries_1HTE, keys_1HTE, "b h q e, b h k e -> b h q k") / HEAD_WIDTH**0.5
        weights_1HTT = scores_1HTT.softmax(dim=-1)
        explicit_1TD = attention.proj(rearrange(weights_1HTT @ values_1HTE, "b h t e -> b t (h e)"))
        fused_1TD = attention(block.norm1(tokens_1TD), rope=rope)
        if not torch.allclose(explicit_1TD, fused_1TD, atol=1e-4, rtol=1e-4):
            raise SystemExit("the explicit attention does not reproduce the block's own output")
        tokens_1TD = block(tokens_1TD, rope)
        streams.append(tokens_1TD[0])
        attentions.append(weights_1HTT[0])
    return streams, attentions, model.norm(tokens_1TD)[0]


def stream_bytes(stream_TD: torch.Tensor) -> bytes:
    values = stream_TD.numpy().astype(np.float32).ravel()
    magnitude = np.abs(values)
    upper = float(np.quantile(magnitude, RANGE_QUANTILE))
    clipped = np.minimum(magnitude, upper)
    levels = np.round(127 * np.log1p(MU * clipped / upper) / np.log1p(MU))
    quantized = (np.sign(values) * levels).astype(np.int8)
    outliers = np.flatnonzero(magnitude > upper).astype(np.uint32)
    header = b"HST1" + struct.pack("<HHfI", TOKENS, WIDTH, upper, len(outliers))
    return header + quantized.tobytes() + outliers.tobytes() + values[outliers].astype(np.float32).tobytes()


def attention_bytes(weights_HTT: torch.Tensor) -> bytes:
    mean_TT = weights_HTT.mean(dim=0).numpy()
    quantized = np.round(255 * np.sqrt(np.clip(mean_TT, 0, 1))).astype(np.uint8)
    return b"HAT1" + struct.pack("<HH", TOKENS, 0) + quantized.tobytes()


def final_bytes(final_TD: torch.Tensor) -> bytes:
    return b"HFN1" + struct.pack("<HH", TOKENS, WIDTH) + final_TD.numpy().astype(np.float16).tobytes()


class Dictionary:
    """The published BSF: 16,384 rank-3 frames, one calibration, one gain (used to reconstruct only)."""

    def __init__(self, path: Path):
        with safe_open(path, framework="pt") as reader:
            self.frames_GDR = reader.get_tensor("frames")
            self.mean_D = reader.get_tensor("calibration_mean")
            self.scale = float(reader.get_tensor("calibration_scale").reshape(-1)[0])
            self.gain = float(reader.get_tensor("gain").reshape(-1)[0])

    def addresses(self, final_TD: torch.Tensor) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Each patch's top 32 blocks by ‖F_gᵀ x‖², ties by block number, with gain-free codes."""
        calibrated_ND = (final_TD[PREFIX:] - self.mean_D) * self.scale
        codes_NGR = einsum(calibrated_ND, self.frames_GDR, "n d, g d r -> n g r")
        energy_NG = codes_NGR.square().sum(dim=-1).numpy()
        # lexsort's last key is primary: energy descending, then block number ascending.
        blocks = np.arange(energy_NG.shape[1])
        winners_NK = np.stack([np.lexsort((blocks, -row))[:WINNERS] for row in energy_NG])
        codes_NKR = np.take_along_axis(codes_NGR.numpy(), winners_NK[:, :, None], axis=1)
        return winners_NK.astype(np.uint16), codes_NKR.astype(np.float32), np.sqrt(np.take_along_axis(energy_NG, winners_NK, axis=1)).astype(np.float32)


def addresses_bytes(blocks_NK: np.ndarray, codes_NKR: np.ndarray, norms_NK: np.ndarray) -> bytes:
    return b"HAD1" + struct.pack("<HH", PATCHES, WINNERS) + blocks_NK.tobytes() + codes_NKR.tobytes() + norms_NK.tobytes()


def significant(values: np.ndarray, digits: int = 3) -> list[float]:
    return [float(f"{value:.{digits}g}") for value in values]


def record_picture(model: torch.nn.Module, dictionary: Dictionary, picture: dict, folder: Path) -> dict:
    streams, attentions, final_TD = probe(model, picture_rgb(picture["imageId"]))
    blocks_NK, codes_NKR, norms_NK = dictionary.addresses(final_TD)
    # Boundary check against the library's own record: the anchor block wins at the anchor patch with
    # the material's anchor code.
    material = json.loads(fetch(f"{GALLERY}/api/materials/{picture['material']}/material.json"))
    anchor = material["anchor"]
    if (anchor["imageId"], anchor["slot"], material["block"]) != (picture["imageId"], picture["slot"], picture["block"]):
        raise SystemExit(f"{picture['material']} is not anchored at picture {picture['imageId']} slot {picture['slot']}")
    patch = picture["slot"] - PREFIX
    rank = np.flatnonzero(blocks_NK[patch] == picture["block"])
    if len(rank) != 1:
        raise SystemExit(f"block {picture['block']} does not win at the anchor patch of {picture['imageId']}")
    difference = float(np.linalg.norm(codes_NKR[patch, rank[0]] - np.asarray(anchor["code"])))
    if difference > ANCHOR_TOLERANCE * anchor["norm"]:
        raise SystemExit(f"anchor code differs by {difference} on {picture['imageId']}")

    folder.mkdir(parents=True, exist_ok=True)
    for depth, stream_TD in enumerate(streams):
        (folder / f"stream-{depth:02d}.bin").write_bytes(stream_bytes(stream_TD))
    for layer, weights_HTT in enumerate(attentions, start=1):
        (folder / f"attention-{layer:02d}.bin").write_bytes(attention_bytes(weights_HTT))
    (folder / "final.bin").write_bytes(final_bytes(final_TD))
    (folder / "addresses.bin").write_bytes(addresses_bytes(blocks_NK, codes_NKR, norms_NK))
    return {
        **picture,
        "anchorRank": int(rank[0]) + 1,
        "anchorCodeDifference": float(f"{difference:.3g}"),
        # D3 and D4: each token's norm at every depth, and each layer's update size ‖after − before‖.
        "tokenNorms": [significant(stream_TD.norm(dim=-1).numpy()) for stream_TD in streams],
        "updateNorms": [significant((after - before).norm(dim=-1).numpy()) for before, after in zip(streams, streams[1:])],
    }


def record_grown(model: torch.nn.Module, dictionary: Dictionary, folder: Path) -> dict:
    """The automaton's picture (prepare_how_automaton_replay.mjs): its PNGs, and DINO's reading of the 256 px one.

    The 128-pixel picture is the replay's bytes as they are; the comparison picture is Pillow's bilinear
    resize to 256, the size the encoder reads. No residual streams are kept: act 3 reads the attention,
    the final tokens and the addresses only.
    """
    replay = json.loads((folder / "replay.json").read_text())
    side = int(replay["side"])
    rgb_HWC = np.fromfile(folder / f"picture-{side}.rgb", dtype=np.uint8).reshape(side, side, 3)
    image = Image.fromarray(rgb_HWC, "RGB")
    image.save(folder / f"picture-{side}.png")
    comparison = image.resize((256, 256), Image.BILINEAR)
    comparison.save(folder / "picture-256.png")
    streams, attentions, final_TD = probe(model, picture_rgb_file(folder / "picture-256.png"))
    blocks_NK, codes_NKR, norms_NK = dictionary.addresses(final_TD)
    for layer, weights_HTT in enumerate(attentions, start=1):
        (folder / f"attention-{layer:02d}.bin").write_bytes(attention_bytes(weights_HTT))
    (folder / "final.bin").write_bytes(final_bytes(final_TD))
    (folder / "addresses.bin").write_bytes(addresses_bytes(blocks_NK, codes_NKR, norms_NK))
    patch_wins = int((blocks_NK == replay["block"]).any(axis=1).sum())
    return {
        "imageId": 0,
        "slot": 0,
        "block": int(replay["block"]),
        "definition": replay["definition"],
        "tick": int(replay["tick"]),
        "comparisonResize": "Pillow bilinear, 128 to 256",
        "selectedPatches": patch_wins,
        "tokenNorms": [significant(stream_TD.norm(dim=-1).numpy()) for stream_TD in streams],
        "updateNorms": [significant((after - before).norm(dim=-1).numpy()) for before, after in zip(streams, streams[1:])],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--grown", type=Path, help="Record the automaton's grown picture in this replay folder instead of the library pictures.")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--encoder", type=Path, required=True)
    parser.add_argument("--dino-source", type=Path, required=True, help="DINOv3 checkout at the pinned revision")
    parser.add_argument("--dictionary", type=Path, required=True, help="Released dictionary.safetensors")
    parser.add_argument(
        "--picture",
        type=int,
        action="append",
        choices=[picture["imageId"] for picture in RECORDED],
        help="Prepare only this picture. Repeat to select several pictures. The default prepares all four.",
    )
    arguments = parser.parse_args()
    torch.set_num_threads(4)
    encoder_digest = sha256(arguments.encoder)
    if encoder_digest != ENCODER_SHA256.get(arguments.encoder.suffix):
        raise SystemExit("Use the pinned DINOv3 ViT-B/16 checkpoint or its lossless safetensors conversion.")
    model = load_encoder(arguments.dino_source, arguments.encoder)
    dictionary = Dictionary(arguments.dictionary)
    provenance = {
        "recorded": date.today().isoformat(),
        "encoder": (
            f"facebookresearch/dinov3@{DINOV3_REVISION}, dinov3_vitb16_pretrain_lvd1689m "
            f"({arguments.encoder.suffix.removeprefix('.')}, SHA-256 {encoder_digest[:16]}…)"
        ),
        "dictionary": f"hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32, dictionary.safetensors (SHA-256 {sha256(arguments.dictionary)[:16]}…)",
        "calibrationScale": dictionary.scale,
        "gain": dictionary.gain,
        "machine": f"PyTorch {torch.__version__} on the CPU, FP32",
    }
    if arguments.grown is not None:
        record = record_grown(model, dictionary, arguments.grown)
        (arguments.grown / "record.json").write_text(json.dumps({"format": 1, "provenance": provenance, **record}, separators=(",", ":")))
        print(f"grown picture of {record['definition']}: group {record['block']} selected on {record['selectedPatches']} of 256 patches")
        return
    pictures = [
        picture for picture in RECORDED
        if arguments.picture is None or picture["imageId"] in arguments.picture
    ]
    for picture in pictures:
        folder = arguments.output / f"picture-{picture['imageId']}"
        record = record_picture(model, dictionary, picture, folder)
        (folder / "record.json").write_text(json.dumps({"format": 1, "provenance": provenance, **record}, separators=(",", ":")))
        size = sum(path.stat().st_size for path in folder.iterdir())
        print(f"picture {picture['imageId']}: block {picture['block']} wins at rank {record['anchorRank']}, "
              f"anchor code within {record['anchorCodeDifference']}, {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
