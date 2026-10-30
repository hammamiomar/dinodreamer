"""The How page's record of the featurizer learning: one patch read through each pass's checkpoint.

The training section (How, act 2, section 5) shows the hibiscus patch rebuilt by the featurizer as
it was after training pass 1, pass 2 and pass 3: which 32 groups it selected then, and how
much of the token was left over as those groups were added back. This script computes that
record from the recorded final tokens of the picture (prepare_how_records.py, final.bin), the two
retained pass checkpoints of the training run, and the released dictionary, which is the run's
end. It writes app/public/how/training/featurizer-passes.json, a few kilobytes.

The selection and the rebuild follow the page's own formula (how-source.ts gateFromWinners and
prepare_how_records.py Dictionary.addresses): x = s · (t − μ) with the release's calibration,
which the run trained on; codes c_g = F_gᵀ x; the 32 groups of largest ‖c_g‖², ties by number;
x̂_k = γ · Σ of the first k selected groups' F_g c_g with that pass's gain γ; the remainder
‖x − x̂_k‖ / ‖x‖ for k = 0 … 32.

Inputs: the pass checkpoints, fetched from the Modal volume dinodreamer-native-runs
(monet-dtd-seed9-20261004/training/passes/pass-00N.pt and their completion records) into the
evidence archive, since each is a few hundred megabytes. The pass losses come from the run's
monitoring as kept in the earlier basis-update.json record (mean of training-batch losses over
the pass); they are copied here so the page reads one file.

Usage: python engine/tools/prepare_how_featurizer_passes.py --passes <checkpoints> --dictionary <dictionary.safetensors> --losses <basis-update.json>

Gate: pass 3's frames equal the release's, and its winners match the recorded addresses of
the material's target patch. All computation uses the CPU.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from datetime import date
from pathlib import Path

import numpy as np
import torch
from safetensors import safe_open

RECORDED = Path("app/public/how/recorded/picture-2985056820452196")
OUTPUT = Path("app/public/how/training/featurizer-passes.json")

IMAGE_ID = 2985056820452196
TOKEN_SLOT = 59
BLOCK = 4009
PREFIX = 5
TOKENS = 261
WIDTH = 768
WINNERS = 32
RANK = 3
PASSES = (1, 2, 3)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_final_token(folder: Path, token_slot: int) -> torch.Tensor:
    """One final token by its slot, including the five prefix tokens (HFN1, float16)."""
    data = (folder / "final.bin").read_bytes()
    if data[:4] != b"HFN1" or struct.unpack("<HH", data[4:8]) != (TOKENS, WIDTH):
        raise SystemExit("final.bin is not the recorded picture's final tokens")
    final_TD = np.frombuffer(data[8:], dtype=np.float16).reshape(TOKENS, WIDTH).astype(np.float32)
    return torch.from_numpy(final_TD[token_slot].copy())


class Release:
    def __init__(self, path: Path):
        with safe_open(path, framework="pt") as reader:
            self.frames_GDR = reader.get_tensor("frames").float()
            self.mean_D = reader.get_tensor("calibration_mean").float()
            self.scale = float(reader.get_tensor("calibration_scale").reshape(-1)[0])
            self.gain = float(reader.get_tensor("gain").reshape(-1)[0])


def load_pass(folder: Path, number: int) -> tuple[torch.Tensor, float, dict]:
    """A retained pass checkpoint's frames and gain, with its completion record."""
    record = json.loads((folder / f"pass-{number:03d}.json").read_text())
    path = folder / record["file"]
    if sha256(path) != record["sha256"]:
        raise SystemExit(f"{path.name} does not match its completion record")
    payload = torch.load(path, map_location="cpu", weights_only=True)
    model = payload["model"]
    frames_GDR = model["frames"].float()
    gain = float(model["log_gain"].exp())
    return frames_GDR, gain, record


def read_through(frames_GDR: torch.Tensor, gain: float, calibrated_D: torch.Tensor) -> dict:
    """The patch's 32 groups under these frames, and the remainder as they are added back."""
    codes_GR = torch.einsum("d, g d r -> g r", calibrated_D, frames_GDR)
    energy_G = codes_GR.square().sum(dim=-1).numpy()
    winners_K = np.lexsort((np.arange(len(energy_G)), -energy_G))[:WINNERS]
    reconstruction_D = torch.zeros(WIDTH)
    size = float(calibrated_D.norm())
    curve = [1.0]
    for group in winners_K:
        reconstruction_D += gain * frames_GDR[group] @ codes_GR[group]
        curve.append(float((calibrated_D - reconstruction_D).norm()) / size)
    return {
        "gain": gain,
        "groups": [int(group) for group in winners_K],
        "norms": [float(f"{value:.4g}") for value in np.sqrt(energy_G[winners_K])],
        "curve": [float(f"{value:.4f}") for value in curve],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--passes", type=Path, required=True, help="folder holding pass-00N.pt and pass-00N.json")
    parser.add_argument("--dictionary", type=Path, required=True, help="Released dictionary.safetensors")
    parser.add_argument("--losses", type=Path, required=True, help="Training pass losses from basis-update.json")
    parser.add_argument("--recorded", type=Path, default=RECORDED, help="Picture folder with final.bin and addresses.bin")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    options = parser.parse_args()

    release = Release(options.dictionary)
    token_D = read_final_token(options.recorded, TOKEN_SLOT)
    calibrated_D = (token_D - release.mean_D) * release.scale
    losses = {entry["pass"]: entry for entry in json.loads(options.losses.read_text())["passes"]}

    passes = []
    for number in PASSES:
        frames_GDR, gain, record = load_pass(options.passes, number)
        if number == PASSES[-1]:
            # The run's end is the release: the same frames, so the page's numbers and this record agree.
            if not torch.allclose(frames_GDR, release.frames_GDR, atol=1e-6) or abs(gain - release.gain) > 1e-6:
                raise SystemExit("pass 3 is not the released dictionary")
        reading = read_through(frames_GDR, gain, calibrated_D)
        loss = losses[number]
        passes.append({
            "pass": number,
            "checkpoint": record["file"],
            "sha256": record["sha256"],
            "updates": record["completed_steps"],
            "loss": {"main": loss["mainLoss"], "auxiliary": loss["auxiliaryLoss"], "total": loss["totalLoss"]},
            **reading,
        })
        rank = reading["groups"].index(BLOCK) + 1 if BLOCK in reading["groups"] else None
        print(f"pass {number}: remainder at 32 = {reading['curve'][-1]:.3f}, group {BLOCK} rank {rank}, gain {gain:.4f}")

    # The final tokens are float16; confirm that their winners still match the FP32 recording.
    final = passes[-1]
    addresses = (options.recorded / "addresses.bin").read_bytes()
    patches = TOKENS - PREFIX
    if addresses[:4] != b"HAD1" or struct.unpack("<HH", addresses[4:8]) != (patches, WINNERS):
        raise SystemExit("addresses.bin is not the recorded picture's patch addresses")
    blocks_NK = np.frombuffer(addresses, dtype="<u2", count=patches * WINNERS, offset=8).reshape(patches, WINNERS)
    patch_index = TOKEN_SLOT - PREFIX
    if final["groups"] != blocks_NK[patch_index].tolist():
        raise SystemExit("pass 3 winners disagree with the recorded target patch")

    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps({
        "format": 1,
        "provenance": {
            "recorded": date.today().isoformat(),
            "run": "monet-dtd-seed9-20261004",
            "checkpoints": "dinodreamer-native-runs:monet-dtd-seed9-20261004/training/passes, retained pass checkpoints",
            "dictionary": f"the released dictionary.safetensors (SHA-256 {sha256(options.dictionary)[:16]}…), equal to pass 3",
            "token": f"final.bin of picture {IMAGE_ID}, token slot {TOKEN_SLOT} (patch index {patch_index}), calibrated with the release's mean and scale",
            "losses": losses[1]["aggregation"],
            "machine": f"PyTorch {torch.__version__} on the CPU, FP32",
        },
        "imageId": IMAGE_ID,
        "slot": TOKEN_SLOT,
        "block": BLOCK,
        "passes": passes,
    }, indent=1) + "\n")
    print(f"wrote {options.output} ({options.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
