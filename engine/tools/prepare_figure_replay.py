"""Make the figure replay oracle from the trainer's own CellRule, on CPU.

The rule runs in the archived reference trainer (original_recipe.py, read-only, SHA-256
checked) from the replay contract's start state and fire masks
(app/src/replay/figure-reference.ts): the same PCG hash, keys and seed as the WebGPU
runtime. It runs twice, in float32 and in float64, so the runner can state the WebGPU
error beside the float32 rounding of the reference itself.

Outputs, row-major cells with 16 channels last ([side, side, 16]):
  rule.f32                 the 7,776 values in the figure layout (17,088 for the pyramid)
  state-tick-NNNNNN.f32    float32 reference state after N ticks (tick 0 = start state)
  state-tick-NNNNNN.f64    float64 reference state after N ticks
  coarse-tick-NNNNNN.f32   the pyramid's coarse grid, [side/2, side/2, 16], float32 and .f64
  display-tick-NNNNNN.rgb  displayed bytes of the float32 state, rounded half to even
  inputs.json              hashes, settings and timing

A pyramid rule.pt (stages 5 and 6, pyramid.py) runs as PyramidRule on the packed state, from the
contract's start states and masks for both grids; the coarse grid uses its own keys. A stage-6
rules/update-NNNN.pt holds only weights: pass its run's rule.pt with --settings, or a selection-margin
run's run.json.

Usage: python engine/tools/prepare_figure_replay.py <run>/rule.pt <output> --research <checkout> --bundle <bundle> [--pyramid <pyramid.py>]
"""
import argparse
import base64
import hashlib
import json
import time
from pathlib import Path

import torch

from figure_contract import (
    COARSE_FIRE_KEY, COARSE_NOISE_KEY, TRAINER_SHA256, cells_last, display_bytes, fire_mask, load_pyramid, load_rules, load_saved,
    sha256, start_state,
)

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("rule", type=Path, help="An E18 rule.pt with settings and state_dict")
parser.add_argument("output", type=Path)
parser.add_argument("--research", type=Path, required=True, help="Research checkout containing src and the archived objective-dynamics study")
parser.add_argument("--bundle", type=Path, required=True, help="BSF bundle containing bsf.py")
parser.add_argument("--pyramid", type=Path, help="The optimizer-schedule study's pyramid.py; required for pyramid rules")
parser.add_argument("--side", type=int, default=128)
parser.add_argument("--seed", type=int, default=1)
parser.add_argument("--ticks", type=int, nargs="+", default=[1, 2, 3, 10, 30, 100, 300, 600])
parser.add_argument("--start-disc", type=float, default=0, help="Seeded start: radius in cells of the noise disc (0: noise everywhere)")
parser.add_argument("--pixels-per-cell", type=int, default=1, choices=(1, 2), help="Picture pixels per cell for the display files")
parser.add_argument("--fixture", type=Path, help="Also write a small JSON fixture for the app's reference-step test")
parser.add_argument("--settings", type=Path, help="The run's rule.pt (or a selection-margin run's run.json), when the rule file holds only its weights")
args = parser.parse_args()

torch.set_num_threads(4)
pyramid = load_saved(args.rule, args.settings)[1].get("rule") == "pyramid"
if pyramid:
    if args.pyramid is None:
        parser.error("--pyramid is required for a pyramid rule")
    rule32, rule64, settings, values = load_pyramid(args.rule, args.research, args.bundle, args.pyramid, args.settings)
else:
    rule32, rule64, settings, values = load_rules(args.rule, args.research, args.bundle, args.settings)
fire_rate = float(settings["fire_rate"])


def rollout(side: int, ticks: list[int], write) -> float:
    """The cell rule's states, or the pyramid's packed states (fine channels 0-15, the coarse grid
    pixel-shuffled in 16-19): the coarse grid steps first, with its own mask, as in masked_step."""
    started = time.perf_counter()
    state32 = start_state(side, args.seed, args.start_disc)
    if pyramid:
        coarse32 = start_state(side // 2, args.seed, args.start_disc / 2, COARSE_NOISE_KEY)
        state32 = rule32.join(state32, coarse32)
    state64 = state32.double()
    write(0, state32, state64)
    with torch.no_grad():
        for tick in range(max(ticks)):
            mask = fire_mask(side, args.seed, tick, fire_rate)
            if pyramid:
                coarse_mask = fire_mask(side // 2, args.seed, tick, fire_rate, COARSE_FIRE_KEY)
                state32 = rule32.masked_step(state32, mask, coarse_mask)
                state64 = rule64.masked_step(state64, mask.double(), coarse_mask.double())
            else:
                state32 = rule32.masked_step(state32, mask)
                state64 = rule64.masked_step(state64, mask.double())
            if tick + 1 in ticks:
                write(tick + 1, state32, state64)
    return time.perf_counter() - started


args.output.mkdir(parents=True, exist_ok=True)
values.tofile(args.output / "rule.f32")


def write_files(tick: int, state32: torch.Tensor, state64: torch.Tensor) -> None:
    if pyramid:
        (fine32, coarse32), (fine64, coarse64) = rule32.split(state32), rule64.split(state64)
        cells_last(coarse32).astype("<f4").tofile(args.output / f"coarse-tick-{tick:06d}.f32")
        cells_last(coarse64).astype("<f8").tofile(args.output / f"coarse-tick-{tick:06d}.f64")
        picture = (rule32.picture(state32)[0] * 255.0).round().byte().permute(1, 2, 0).contiguous().numpy()
        state32, state64 = fine32, fine64
    cells_last(state32).astype("<f4").tofile(args.output / f"state-tick-{tick:06d}.f32")
    cells_last(state64).astype("<f8").tofile(args.output / f"state-tick-{tick:06d}.f64")
    (picture if pyramid else display_bytes(state32, args.pixels_per_cell)).tofile(args.output / f"display-tick-{tick:06d}.rgb")


seconds = rollout(args.side, args.ticks, write_files)
metadata = {
    "rule": str(args.rule), "ruleSha256": sha256(args.rule), **({"settingsFile": str(args.settings)} if args.settings else {}),
    "ruleValuesSha256": hashlib.sha256(values.tobytes()).hexdigest(),
    "trainer": str(args.research / "research/2026-10-22-objective-dynamics/original_recipe.py"), "trainerSha256": TRAINER_SHA256,
    "settings": {key: settings[key] for key in ("block", "seed", "fire_rate", "size", "channels", "hidden", "init")},
    "layout": "figure-pyramid-16-96-torus-v1" if pyramid else "figure-16-96-torus-v1",
    "replay": {"side": args.side, "seed": args.seed, "fireRate": fire_rate, "startDisc": args.start_disc,
               "pixelsPerCell": args.pixels_per_cell, "ticks": [0, *args.ticks]},
    "stateLayout": f"[{args.side},{args.side},16] row-major cells, channels last",
    "torch": torch.__version__, "threads": torch.get_num_threads(), "rolloutSeconds": round(seconds, 2),
}
(args.output / "inputs.json").write_text(json.dumps(metadata, indent=2) + "\n")

if args.fixture:
    states = {}

    def encode(state: torch.Tensor) -> str:
        return base64.b64encode(cells_last(state).astype("<f4").tobytes()).decode()

    def keep(tick: int, state32: torch.Tensor, _state64: torch.Tensor) -> None:
        if pyramid:
            fine32, coarse32 = rule32.split(state32)
            states[str(tick)] = {"fine": encode(fine32), "coarse": encode(coarse32)}
        else:
            states[str(tick)] = encode(state32)

    rollout(8, [1, 2, 3], keep)
    fixture = {
        "note": ("The optimizer-schedule study's PyramidRule (pyramid.py) on the packed state" if pyramid else "Trainer CellRule (original_recipe.py)")
        + " from the replay contract's start states and masks; side 8.",
        "ruleValuesSha256": metadata["ruleValuesSha256"], "side": 8, "seed": args.seed, "fireRate": fire_rate,
        "statesFloat32Base64": states,
    }
    args.fixture.write_text(json.dumps(fixture, indent=1) + "\n")
print(json.dumps(metadata, indent=2))
