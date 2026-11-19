"""CPU oracle for the figure recipe: the archived trainer's own functions, driven by the
engine's draws, for the first updates of one request of one kind.

The engine (engine/src/grow/figure.rs) draws every random value from the PCG streams of
engine/src/grow/draws.rs. This script regenerates the same values with numpy and feeds them
to original_recipe.py (CellRule.masked_step, eight_bit, torch.roll, sample_wrapped,
block_terms), to the sweep trainer (trainer.py: seeded, picture, CENTRE_T; pyramid.py:
PyramidRule) and to strength.py's mean-arm loss; Adam, the cosine rate and per-tensor
normalization follow the trainer's loop line by line. It records what the reference
computes; `examples/grow_recipe_parity.rs` compares the engine against the record.

The kind is `--rule cell|pyramid` and `--start noise|centre-disc`. With `--continue-from` a saved
definition's rule, update and training seed start the record in place of the random initialization
(Train resume, case 2): a fresh Adam and a fresh pool, the updates numbered from the definition's.
The pyramid's state is a packed tensor: channels 0-15 the fine grid, 16-19 the coarse grid
pixel-shuffled by 2. The engine keeps the coarse grid as its own [B*64*64, 16] tensor; the record converts.

The method is `--method`. Basis-group mean matching is the loss above. The three other methods
compare the canvas with a target set (`--set`, a target-set JSON manifest and contact sheet: the windows as
raw pixels and the patch of each). Their loss is the given-set tool's own `Objective`
(research/given-set/givenset/objective.py) on tokens from its own `Reader`, with the trainer's
dial at 1: token mean (`point`), basis-group distribution (`projection-mmd`) and token
distribution (`mmd`). `--layers` names the token methods' layers ("block-3", ..., "final").
The basis-group mean loss is recorded beside them as a reading.

Run on CPU in the research environment. The archive and sweep trainer are imported
read-only and checked by SHA-256. Fixtures above 1 MB store each update in a separate
JSON file beside the main fixture. No numerical values are omitted.

Usage: python engine/tools/prepare_grow_recipe.py --research <checkout> --dino-source <source> --dino-weights <checkpoint> --bundle <bundle> --input <block.json> --strength <study> --sweep <study> --output <fixture.json>
  [--method token-distribution --layers block-3,block-6,block-9,final --given-set <research/given-set> --set <set.json>]

Axes: B grids, C = 16 state channels, H = W = 128, V = 2B views, T = 64 patches, R = 3,
P set pictures, N set tokens, M = V x scored patches canvas tokens, D = 768.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import sys
import time
import types
from pathlib import Path

import numpy as np
import torch

ARCHIVE_SHA256 = "5c10352e424989e1f423b8fa05745127e922ae3b98ab4410fea79225da516bdf"
# The sweep trainer and pyramid rule as of stage 6 (research commit ee76d84a). The second trainer
# (research commit abdb8f33, the given-set tool's) only adds the seeded-field starts; noise and the
# centre disc are unchanged.
TRAINER_SHA256 = (
    "2abcf6a8b3020e1199a320e696367e92dd77adb3cf3b45d627c5838ba1a47e88",
    "b540d6914c9591e808451b468e1389a26b8979ebc2497895256c9e9b741b709f",
)
PYRAMID_SHA256 = "86434dfec7918a064a82078aa147e7a9c10202f161b7bf93af85856e4d2d2766"
# The research's objective kind of each method (research/given-set/README.md, "The four methods").
METHOD_KINDS = {
    "basis-group-mean": "plain",
    "token-mean": "point",
    "basis-group-distribution": "projection-mmd",
    "token-distribution": "mmd",
}
WINDOW_SIDE = 128
SET_SCALE = "128"  # the aligned window meets the 128 px canvas (the given-set tool's scale rule)

# engine/src/grow/draws.rs and engine/src/grow/figure.rs
NOISE, FIRE = 0x6E6F6973, 0x66697265
INIT, POOL, RESET, PICK, ROLL, VIEW, TRAIN_FIRE = (
    0x696E6974, 0x706F6F6C, 0x72736574, 0x7069636B, 0x726F6C6C, 0x76696577, 0x74666972,
)
COARSE_NOISE, COARSE_FIRE, COARSE_POOL, COARSE_RESET, COARSE_TRAIN_FIRE = (
    0x636E6F69, 0x63666972, 0x63706F6C, 0x63727374, 0x63746669,
)
SIDE, CELLS, CHANNELS, POOL_SIZE = 128, 128 * 128, 16, 64
COARSE_SIDE = SIDE // 2
ROLLOUT_MIN, ROLLOUT_MAX, FIRE_RATE = 32, 64, 0.5
UPDATES, LEARNING_RATE, FINAL_LEARNING_RATE, OVERFLOW_WEIGHT = 1000, 2e-3, 2e-4, 10.0
MAX_FIXTURE_BYTES = 1_000_000
BATCH_1_RESET_EVERY = 4
SCALES = (0.95, 0.975, 1.0, 1.025, 1.05)
MASK32 = 0xFFFFFFFF


def pcg(values):
    """The PCG hash (Jarzynski and Olano 2020), modulo 2^32, on any integer array."""
    v = np.asarray(values, dtype=np.uint64) & MASK32
    state = (v * 747796405 + 2891336453) & MASK32
    word = (((state >> ((state >> 28) + 4)) ^ state) * 277803737) & MASK32
    return (word >> 22) ^ word


class Stream:
    """One keyed sequence: Stream(seed, purpose).at(counter) as in draws.rs."""

    def __init__(self, key: int):
        self.key = int(key)

    @classmethod
    def new(cls, seed: int, purpose: int) -> "Stream":
        return cls(pcg(seed ^ purpose))

    def at(self, counter: int) -> "Stream":
        return Stream(pcg((self.key + counter) & MASK32))

    def bits(self, index):
        return pcg((self.key + np.asarray(index, dtype=np.uint64)) & MASK32) >> 8

    def uniform(self, count: int) -> np.ndarray:
        return self.bits(np.arange(count)).astype(np.float32) / np.float32(16777216.0)

    def below(self, index: int, count: int) -> int:
        return int((int(self.bits(index)) * count) >> 24)

    def state(self, side: int = SIDE) -> torch.Tensor:
        """A noise state [1, C, side, side]; the engine's index is cell * 16 + channel."""
        values = self.uniform(side * side * CHANNELS) - np.float32(0.5)
        return torch.from_numpy(values.reshape(side, side, CHANNELS).transpose(2, 0, 1).copy())[None]

    def fired(self, grids: int, side: int = SIDE) -> torch.Tensor:
        """[B, 1, side, side], 1 where a cell fires; the engine's index is grid * side^2 + cell."""
        mask = (self.uniform(grids * side * side) < np.float32(FIRE_RATE)).astype(np.float32)
        return torch.from_numpy(mask.reshape(grids, 1, side, side))


class Kind:
    """The rule and the start of a request, with the trainer functions for them."""

    def __init__(self, rule_name: str, start: str, original, trainer, pyramid):
        self.rule_name, self.start, self.trainer = rule_name, start, trainer
        self.pyramid = rule_name == "pyramid"
        self.new_rule = (lambda: pyramid.PyramidRule(CHANNELS, 96)) if self.pyramid else (lambda: original.CellRule(CHANNELS, 96))
        self.patches = trainer.CENTRE_T if start == "centre-disc" else list(range(64))
        self.render = types.SimpleNamespace(render=1)

    def fresh(self, rule, fine: Stream, coarse: Stream) -> torch.Tensor:
        """One grid's start [1, C(+4), H, W] from the engine's fine and coarse noise streams."""
        state = fine.state()
        if self.pyramid:
            state = rule.join(state, coarse.state(COARSE_SIDE))
        return self.trainer.seeded(state, self.start, rule)

    def step(self, rule, state, fine: Stream, coarse: Stream) -> torch.Tensor:
        grids = state.shape[0]
        if self.pyramid:
            return rule.masked_step(state, fine.fired(grids), coarse.fired(grids, COARSE_SIDE))
        return rule.masked_step(state, fine.fired(grids))

    def picture(self, rule, state) -> torch.Tensor:
        return self.trainer.picture(rule, state, self.render)

    def engine_layout(self, rule, state) -> tuple[np.ndarray, np.ndarray | None]:
        """The fine grids [B*H*W*C] and the pyramid's coarse grids [B*H/2*W/2*C] in the engine's layout."""
        if not self.pyramid:
            return cells(state), None
        fine, coarse = rule.split(state)
        return cells(fine), cells(coarse)


def plan(seed: int, update: int, batch: int) -> dict:
    """figure.rs Plan::draw."""
    pick = Stream.new(seed, PICK).at(update)
    order = list(range(POOL_SIZE))
    for slot in range(batch):
        chosen = slot + pick.below(slot, POOL_SIZE - slot)
        order[slot], order[chosen] = order[chosen], order[slot]
    view = Stream.new(seed, VIEW).at(update)
    views = [
        {
            "shift": [view.below(4 * index, 33) - 16, view.below(4 * index + 1, 33) - 16],
            "scale": SCALES[view.below(4 * index + 2, len(SCALES))],
            "degrees": view.below(4 * index + 3, 11) - 5,
        }
        for index in range(2 * batch)
    ]
    return {
        "entries": order[:batch],
        "reset": batch == 4 or update % BATCH_1_RESET_EVERY == 0,
        "steps": ROLLOUT_MIN + Stream.new(seed, ROLL).at(update).below(0, ROLLOUT_MAX - ROLLOUT_MIN + 1),
        "views": views,
    }


def distill(original, pictures_B3HW: torch.Tensor, views: list[dict]) -> torch.Tensor:
    """original_recipe.distill_views with the engine's drawn rolls, scales and degrees."""
    rolled = [
        torch.roll(pictures_B3HW[index // 2], shifts=view["shift"], dims=(1, 2)) for index, view in enumerate(views)
    ]
    rolled_N3HW = torch.stack(rolled)
    scale_N = torch.tensor([view["scale"] for view in views], dtype=torch.float32)
    radians_N = torch.deg2rad(torch.tensor([view["degrees"] for view in views]).float())
    cos_N, sin_N = radians_N.cos() / scale_N, radians_N.sin() / scale_N
    zeros_N = torch.zeros(len(views))
    matrices_N23 = torch.stack((torch.stack((cos_N, -sin_N, zeros_N), -1), torch.stack((sin_N, cos_N, zeros_N), -1)), 1)
    return original.sample_wrapped(rolled_N3HW, matrices_N23)


def initial_values(seed: int, pyramid: bool) -> np.ndarray:
    """figure/rule.rs FigureRule::randomly_initialized: U(-1/sqrt(fan_in), 1/sqrt(fan_in)) for each fc1's weight
    and bias (fan-in 64; the pyramid's fine rule 80), zero fc2; value i draws index i of INIT."""
    fan_ins = (64, 80) if pyramid else (64,)
    values = np.zeros(17088 if pyramid else 7776, dtype=np.float32)
    drawn = Stream.new(seed, INIT).uniform(len(values))
    first = 0
    for fan_in in fan_ins:
        count = 96 * fan_in + 96
        values[first : first + count] = (drawn[first : first + count] * np.float32(2.0) - np.float32(1.0)) / np.sqrt(np.float32(fan_in))
        first += count + 16 * 96
    return values


def rule_values(rule) -> np.ndarray:
    return torch.cat([parameter.detach().flatten() for parameter in rule.parameters()]).numpy().astype(np.float32)


def encode(values) -> str:
    return base64.b64encode(np.ascontiguousarray(values, dtype="<f4").tobytes()).decode()


def cells(state_BCHW: torch.Tensor) -> np.ndarray:
    """The engine's layout [1, B*H*W, C], flattened."""
    return state_BCHW.detach().permute(0, 2, 3, 1).reshape(-1).numpy()


def grow_and_read(kind: Kind, rule, dino, model, request, frame_DR, direction_R, median_norm, seed, ticks):
    """The live grid's replay contract (draws.rs): the start from (seed, NOISE) and, for the
    pyramid's coarse grid, (seed, COARSE_NOISE); fire from (seed, FIRE).at(t) and (seed, COARSE_FIRE).at(t).
    Strength and winners count the kind's patches: all 64, or the central 4 x 4."""
    with torch.no_grad():
        state = kind.fresh(rule, Stream.new(seed, NOISE), Stream.new(seed, COARSE_NOISE))
        for tick in range(ticks):
            state = kind.step(rule, state, Stream.new(seed, FIRE).at(tick), Stream.new(seed, COARSE_FIRE).at(tick))
        levels = (kind.picture(rule, state) * 255.0).round()
        native_1SD = dino.native_tokens(levels / 255.0)
        calibrated_TD = model.scale * (native_1SD[0, 5:] - model.mean_D)
        codes_TR = calibrated_TD @ frame_DR
        responses_TG = model.responses(calibrated_TD)
        own_T = codes_TR.square().sum(-1)
        winners_T = (responses_TG > own_T[:, None]).sum(-1) < 32
    read = kind.patches
    return {
        "seed": seed,
        "ticks": ticks,
        "strength": float((codes_TR[read] @ direction_R).mean() / median_norm),
        "winnerFraction": float(winners_T[read].float().mean()),
        "meanCode": codes_TR[read].mean(0).tolist(),
        "levels": base64.b64encode(levels[0].permute(1, 2, 0).numpy().astype(np.uint8).tobytes()).decode(),
    }


def first_gradient(kind: Kind, original, dino, seed, batch, values, update, dtype, method_loss) -> torch.Tensor:
    """The normalized gradient [P] of the record's first update in `dtype`, from its draws and the starting `values`.
    DINO runs in `dtype` too; float64 converts the model in place. `method_loss(views_V3HW, dtype)` is the
    method's loss term on the views. `dtype` is also the default while it runs, so the views' sampling grid has it too."""
    default = torch.get_default_dtype()
    torch.set_default_dtype(dtype)
    try:
        return _first_gradient(kind, original, dino, seed, batch, values, update, dtype, method_loss)
    finally:
        torch.set_default_dtype(default)


def _first_gradient(kind: Kind, original, dino, seed, batch, values, update, dtype, method_loss) -> torch.Tensor:
    rule = kind.new_rule().to(dtype)
    initial = torch.from_numpy(np.array(values, dtype=np.float32)).to(dtype)
    with torch.no_grad():
        start = 0
        for parameter in rule.parameters():
            parameter.copy_(initial[start : start + parameter.numel()].reshape(parameter.shape))
            start += parameter.numel()
    drawn = plan(seed, update, batch)
    grids = [kind.fresh(rule, Stream.new(seed, POOL).at(entry), Stream.new(seed, COARSE_POOL).at(entry)) for entry in drawn["entries"]]
    state_BCHW = torch.cat(grids).to(dtype)
    if drawn["reset"]:
        state_BCHW[0] = kind.fresh(rule, Stream.new(seed, RESET).at(update), Stream.new(seed, COARSE_RESET).at(update))[0].to(dtype)
    fine_fire, coarse_fire = Stream.new(seed, TRAIN_FIRE).at(update), Stream.new(seed, COARSE_TRAIN_FIRE).at(update)
    for step in range(drawn["steps"]):
        state_BCHW = kind.step(rule, state_BCHW, fine_fire.at(step), coarse_fire.at(step))
    views_V3HW = distill(original, original.eight_bit(kind.picture(rule, state_BCHW)), drawn["views"])
    dino.model.to(dtype)
    loss = method_loss(views_V3HW, dtype) + OVERFLOW_WEIGHT * (state_BCHW - state_BCHW.clamp(-1.0, 1.0)).abs().mean()
    loss.backward()
    return torch.cat([parameter.grad.flatten() / (parameter.grad.norm() + 1e-8) for parameter in rule.parameters()])


def basis_group_mean_loss(kind: Kind, dino, model, request, code_R, median_norm):
    """mean_v ||mean_{t in P} c_vt - k||^2 / m^2 in any float type, from DINO called as `native_tokens` calls it."""
    def loss(views_V3HW: torch.Tensor, dtype: torch.dtype) -> torch.Tensor:
        normalized_V3HW = (views_V3HW - dino.mean_1C11.to(dtype)) / dino.std_1C11.to(dtype)
        native_VTD = dino.model.get_intermediate_layers(normalized_V3HW, n=(11,), reshape=False, return_class_token=True,
                                                        return_extra_tokens=True, norm=True)[0][0]
        codes_VTR = (model.scale.to(dtype) * (native_VTD - model.mean_D.to(dtype))) @ request.frame_DR.to(dtype)
        codes_VTR = codes_VTR[:, kind.patches]
        return (codes_VTR.mean(1) - code_R.to(dtype)).square().sum(-1).mean() / median_norm**2
    return loss


def load_target_set(path: Path) -> tuple[torch.Tensor, list[int], dict]:
    """Load a target-set JSON manifest: the windows [P, 3, 128, 128] as uint8, cut from its sheet (row-major,
    `columns` windows a row), and the dot of each window, its patch on the window's 8 x 8 grid."""
    from PIL import Image

    record = json.loads(path.read_text())
    sheet_HW3 = np.asarray(Image.open(path.with_name(record["sheet"])).convert("RGB"), np.uint8)
    windows = []
    for index in range(len(record["pictures"])):
        row, column = divmod(index, record["columns"])
        windows.append(sheet_HW3[row * WINDOW_SIDE:(row + 1) * WINDOW_SIDE, column * WINDOW_SIDE:(column + 1) * WINDOW_SIDE])
    windows_P3HW = torch.from_numpy(np.stack(windows)).permute(0, 3, 1, 2).contiguous()
    return windows_P3HW, [int(picture["dot"]) for picture in record["pictures"]], record


class AnyFloatReadout:
    """The given-set Reader's DINO in any float type. DinoReadout._normalized_rgb accepts float32 only; this
    normalizes with the same mean and standard deviation in the input's type, for the float64 floor."""

    def __init__(self, dino):
        self.model, self.mean_1C11, self.std_1C11 = dino.model, dino.mean_1C11, dino.std_1C11

    def _normalized_rgb(self, rgb_BCHW: torch.Tensor) -> torch.Tensor:
        return (rgb_BCHW - self.mean_1C11.to(rgb_BCHW.dtype)) / self.std_1C11.to(rgb_BCHW.dtype)


class SetMethod:
    """Token mean, basis-group distribution or token distribution: the given-set tool's Objective on the 3 x 3
    tokens of the set's windows, read with its Reader, as `given_set.build` and `recipe.Trainer` do at scale 128.
    The set is read in `dtype` (float32, or float64 for the floor)."""

    def __init__(self, method: str, layers: tuple[str, ...], givenset, reader, block: int, windows_P3HW, dots, seed: int, dtype):
        self.givenset, self.reader, self.dtype = givenset, reader, dtype
        self.kind = METHOD_KINDS[method]
        self.layers = layers
        config = givenset.objective.ObjectiveConfig(kind=self.kind, layers=layers)
        frame_DR = reader.model.frames_GDR[block].detach()
        projector = None
        if self.kind == "projection-mmd":  # recipe.Trainer's projector_for; the cast is a no-op in float32
            projector = lambda tokens: reader.calibrated(tokens) @ frame_DR.to(tokens.dtype)  # noqa: E731
        self.frame_DR = frame_DR
        self.read_layers = tuple(dict.fromkeys((*layers, givenset.reader.FINAL)))  # recipe.Trainer.layers
        self.set_tokens = self.read_set(windows_P3HW, dots)
        given = types.SimpleNamespace(tokens={SET_SCALE: self.set_tokens})
        self.objective = givenset.objective.Objective(config, given, SET_SCALE, seed, projector)

    def read_set(self, windows_P3HW, dots) -> dict[str, torch.Tensor]:
        """Per layer [N, D]: the 3 x 3 tokens around each window's dot, picture by picture (given_set.build)."""
        library, given_set = self.givenset.library, self.givenset.given_set
        tokens = {layer: [] for layer in self.layers}
        with torch.no_grad():
            for window_3HW, dot in zip(windows_P3HW, dots):
                pixels_HWC = window_3HW.permute(1, 2, 0).numpy()
                if self.dtype == torch.float32:
                    rgb_13HW = given_set.tensor_of(pixels_HWC, "cpu")
                else:
                    rgb_13HW = torch.from_numpy(pixels_HWC.copy()).permute(2, 0, 1)[None].to(self.dtype) / 255
                reading = self.reader.read(rgb_13HW, self.layers)
                kept = library.neighbourhood_patches(dot, "3x3", library.WINDOW_PATCHES)
                for layer in self.layers:
                    tokens[layer].append(reading.tokens[layer][0, kept])
        return {layer: torch.cat(values) for layer, values in tokens.items()}

    def value(self, views_V3HW: torch.Tensor, patches) -> tuple[torch.Tensor, dict, torch.Tensor]:
        """The set loss over the layers, its terms, and the scored final tokens [V, T, D] (recipe.Trainer.step)."""
        reading = self.reader.read(views_V3HW, self.read_layers)
        region = {layer: tokens[:, patches] for layer, tokens in reading.tokens.items()}
        value, terms = self.objective.value(region)
        return value, terms, region[self.givenset.reader.FINAL]

    def layer_terms(self, terms: dict) -> list[dict]:
        """Per layer, in the request's order: the layer's value and, for a distribution, the kernel means xx and xy."""
        if self.kind == "point":
            return [{"layer": layer, "value": terms[f"point_{layer}"]} for layer in self.layers]
        return [{"layer": layer, "value": terms[f"mmd_{layer}"], "xx": terms[f"mmd_xx_{layer}"], "xy": terms[f"mmd_xy_{layer}"]}
                for layer in self.layers]

    def record(self) -> dict:
        """The prepared set per layer: what the engine's preparation must reproduce. The standardized features are
        recorded whole up to 4,096 values, else every 257th."""
        layers = []
        for layer, prepared in self.objective.prepared.items():
            features = prepared.set_ND.detach().flatten().numpy()
            step = 1 if features.size <= 4096 else 257
            layers.append({
                "layer": layer,
                "tokens": int(prepared.set_ND.shape[0]),
                "width": int(prepared.set_ND.shape[1]),
                "mean": encode(prepared.mean_D.detach().numpy()),
                "rms": float(prepared.rms),
                "medianDistance": float(prepared.median_distance),
                "widths": prepared.widths.tolist(),
                "yy": float(prepared.yy),
                "standardizedStep": step,
                "standardized": encode(features[::step]),
            })
        return {"layers": layers}


def research_set_check(given_set_root: Path, set_file: dict, tokens: dict[str, torch.Tensor]) -> dict | None:
    """Relative RMS, per layer, of the oracle's set tokens against the research's own saved set at scale 128, when
    the set file names one and it is on disk: the same windows read by the same Reader must give the same tokens."""
    name = set_file.get("provenance", {}).get("researchSet")
    path = given_set_root / "out" / "sets" / f"{name}.pt"
    if not name or not path.exists():
        return None
    saved = torch.load(path, map_location="cpu", weights_only=False)["tokens"][SET_SCALE]
    return {layer: float((value - saved[layer]).norm() / saved[layer].norm()) for layer, value in tokens.items()}


def given_set_provenance(root: Path) -> dict:
    files = ("objective.py", "reader.py", "given_set.py", "library.py", "recipe.py")
    return {name: hashlib.sha256((root / "givenset" / name).read_bytes()).hexdigest() for name in files}


def checked_import(folder: Path, name: str, accepted: str | tuple[str, ...]):
    accepted = (accepted,) if isinstance(accepted, str) else accepted
    if hashlib.sha256((folder / f"{name}.py").read_bytes()).hexdigest() not in accepted:
        raise SystemExit(f"{folder / name}.py is not an expected source (SHA-256 {', '.join(value[:8] for value in accepted)}...)")
    return __import__(name)


def write_fixture(output: Path, fixture: dict) -> None:
    """Keep every recorded value; move updates to separate files when the fixture exceeds 1 MB."""
    files = {output: json.dumps(fixture) + "\n"}
    if len(files[output].encode()) > MAX_FIXTURE_BYTES:
        folder = output.with_name(f"{output.stem}-updates")
        updates = {
            folder / f"update-{record['update']:06d}.json": json.dumps(record) + "\n"
            for record in fixture["updates"]
        }
        record = {key: value for key, value in fixture.items() if key != "updates"}
        record["updateFiles"] = [path.relative_to(output.parent).as_posix() for path in updates]
        files = {**updates, output: json.dumps(record) + "\n"}
    for path, content in files.items():
        if len(content.encode()) > MAX_FIXTURE_BYTES:
            raise ValueError(f"{path} exceeds the 1 MB fixture limit")
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, required=True, help="E9's frozen block input")
    parser.add_argument("--strength", type=Path, required=True, help="E18's study folder (strength.py)")
    parser.add_argument("--sweep", type=Path, required=True, help="optimizer-schedule study (trainer.py, pyramid.py)")
    parser.add_argument("--rule", default="cell", choices=("cell", "pyramid"))
    parser.add_argument("--start", default="noise", choices=("noise", "centre-disc"))
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--batch", type=int, default=4, choices=(1, 4))
    parser.add_argument("--updates", type=int, default=3)
    parser.add_argument("--lockstep", default="", help="comma-separated updates whose parameters and initial "
                        "states are recorded, so the engine can repeat exactly that update (large output)")
    parser.add_argument("--read-seed", type=int, default=9317, help="live-grid seed for the readouts")
    parser.add_argument("--read-ticks", type=int, default=600)
    parser.add_argument("--reading-rule", type=Path, action="append", default=[],
                        help="a saved rule (.pt with a state_dict) of the same kind to read besides the last trained rule (repeatable)")
    parser.add_argument("--continue-from", type=Path, help="a saved automaton definition (format 4): its rule, update and "
                        "training seed start the record, with a fresh Adam and a fresh pool (Train resume, case 2)")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--research", type=Path, required=True, help="Research checkout containing src and the archived objective-dynamics study")
    parser.add_argument("--dino-source", type=Path, required=True, help="DINOv3 source checkout")
    parser.add_argument("--dino-weights", type=Path, required=True, help="DINOv3 checkpoint")
    parser.add_argument("--bundle", type=Path, required=True, help="BSF bundle containing bsf.py and its weights")
    parser.add_argument("--method", default="basis-group-mean", choices=tuple(METHOD_KINDS))
    parser.add_argument("--layers", default="", help="the token methods' layers, comma-separated: block-3, block-6, block-9, final")
    parser.add_argument("--given-set", type=Path, help="the given-set tool (research/given-set), for the set methods")
    parser.add_argument("--set", type=Path, help="a target-set JSON manifest, for the set methods")
    args = parser.parse_args()
    set_method_chosen = args.method != "basis-group-mean"
    if set_method_chosen != bool(args.given_set and args.set):
        raise SystemExit("--given-set and --set go with a set method, and only with one")
    token_method = args.method in ("token-mean", "token-distribution")
    if token_method != bool(args.layers):
        raise SystemExit("--layers goes with a token method, and only with one")
    layers = tuple(args.layers.split(",")) if token_method else (("final",) if set_method_chosen else ())
    first = 0
    continued_from = None
    if args.continue_from:
        definition = json.loads(args.continue_from.read_text())
        layout_rule = "pyramid" if "pyramid" in definition["rule"]["layout"] else "cell"
        if layout_rule != args.rule:
            raise SystemExit(f"{args.continue_from.name} holds a {layout_rule} rule, not {args.rule}")
        args.seed = int(definition["training"]["seed"])
        first = int(definition["training"]["updates"])
        continued_from = {"id": definition["id"], "fromUpdate": first,
                          "sha256": hashlib.sha256(args.continue_from.read_bytes()).hexdigest()}
    started = time.perf_counter()
    torch.set_num_threads(8)

    objective_dynamics = args.research / "research/2026-10-22-objective-dynamics"
    archive = objective_dynamics / "original_recipe.py"
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("original_recipe.py is not the archived trainer")
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(args.bundle.resolve()), str((args.research / "src").resolve()), str(objective_dynamics.resolve())]
    # Load the selected bundle before the archived module adds its historical search paths.
    __import__("bsf")
    sys.path.insert(0, str(args.strength.resolve()))
    import original_recipe as original  # noqa: E402
    import strength  # noqa: E402
    import train as e9  # noqa: E402

    sys.path.insert(0, str(args.sweep.resolve()))
    pyramid = checked_import(args.sweep, "pyramid", PYRAMID_SHA256)
    trainer = checked_import(args.sweep, "trainer", TRAINER_SHA256)
    kind = Kind(args.rule, args.start, original, trainer, pyramid)

    payload = json.loads(args.input.read_text())
    block = int(payload["block"])
    reader_identity = e9.validate_input(payload, block)
    selected = strength.select_strongest(payload)["codes"]["strongest"]
    code_R = torch.tensor(selected["code"], dtype=torch.float32)
    median_norm = float(payload["request"]["median_norm"])
    direction_R = torch.tensor(payload["request"]["u1"], dtype=torch.float32)

    device = torch.device("cpu")
    dino = original.load_dinov3(args.dino_source, args.dino_weights, device)
    model = original.bsf.load_bundle(args.bundle, device)
    request = e9.load_request(payload, model, device)
    set_method = None
    if set_method_chosen:
        sys.path.insert(0, str(args.given_set.resolve()))
        import givenset.given_set  # noqa: E402  (givenset.paths puts the studies on sys.path; the modules above are reused)
        import givenset.library  # noqa: E402
        import givenset.objective  # noqa: E402
        import givenset.reader  # noqa: E402

        reader = givenset.reader.Reader("cpu", dino=dino, model=model)
        windows_P3HW, dots, set_file = load_target_set(args.set)
        if set_file["block"] != block:
            raise SystemExit(f"{args.set.name} is a set of basis group {set_file['block']}, not {block}")
        set_method = SetMethod(args.method, layers, givenset, reader, block, windows_P3HW, dots, args.seed, torch.float32)
    loaded = time.perf_counter()

    rule = kind.new_rule()
    starting = (np.frombuffer(base64.b64decode(definition["rule"]["values"]), dtype="<f4").copy() if args.continue_from
                else initial_values(args.seed, kind.pyramid))
    initial = torch.from_numpy(starting)
    with torch.no_grad():
        start = 0
        for parameter in rule.parameters():
            parameter.copy_(initial[start : start + parameter.numel()].reshape(parameter.shape))
            start += parameter.numel()
    optimizer = torch.optim.Adam(rule.parameters(), lr=LEARNING_RATE)
    pool: dict[int, torch.Tensor] = {}
    records = []
    lockstep_updates = {int(value) for value in args.lockstep.split(",") if value}
    lockstep = []

    def encoded_states(state_BCHW: torch.Tensor, prefix: str) -> dict:
        """Every 257th value of the fine grids and, for the pyramid, of the coarse grids, in the engine's layout."""
        fine, coarse = kind.engine_layout(rule, state_BCHW)
        record = {prefix: encode(fine[::257])}
        if coarse is not None:
            record[f"{prefix[:-len('Sample')]}CoarseSample"] = encode(coarse[::257])
        return record

    for update in range(first, first + args.updates):
        drawn = plan(args.seed, update, args.batch)
        # The engine holds the final rate past update 999 (figure.rs learning_rate).
        progress = min(update, UPDATES - 1) / max(UPDATES - 1, 1)
        lr = FINAL_LEARNING_RATE + 0.5 * (LEARNING_RATE - FINAL_LEARNING_RATE) * (1 + math.cos(math.pi * progress))
        for group in optimizer.param_groups:
            group["lr"] = lr
        grids = [pool.get(entry) for entry in drawn["entries"]]
        grids = [grid if grid is not None else kind.fresh(rule, Stream.new(args.seed, POOL).at(entry),
                                                          Stream.new(args.seed, COARSE_POOL).at(entry))
                 for grid, entry in zip(grids, drawn["entries"])]
        state_BCHW = torch.cat(grids).clone()
        if drawn["reset"]:
            state_BCHW[0] = kind.fresh(rule, Stream.new(args.seed, RESET).at(update), Stream.new(args.seed, COARSE_RESET).at(update))[0]
        before = None
        if update in lockstep_updates:
            fine, coarse = kind.engine_layout(rule, state_BCHW)
            before = {"values": encode(rule_values(rule)), "initial": encode(fine),
                      **({"initialCoarse": encode(coarse)} if coarse is not None else {})}
        fine_fire = Stream.new(args.seed, TRAIN_FIRE).at(update)
        coarse_fire = Stream.new(args.seed, COARSE_TRAIN_FIRE).at(update)
        for step in range(drawn["steps"]):
            state_BCHW = kind.step(rule, state_BCHW, fine_fire.at(step), coarse_fire.at(step))
        rgb_B3HW = original.eight_bit(kind.picture(rule, state_BCHW))
        views_V3HW = distill(original, rgb_B3HW, drawn["views"])
        layer_terms = None
        if set_method is None:
            terms = original.block_terms(dino, model, request, views_V3HW, gate=False, margin=0.1)
            codes_VTR = terms["codes"][:, kind.patches]
            code_loss = strength.mean_code_loss(codes_VTR, code_R.to(codes_VTR), median_norm**2).mean()
            method_loss = code_loss
        else:
            method_loss, objective_terms, final_VTD = set_method.value(views_V3HW, kind.patches)
            layer_terms = set_method.layer_terms(objective_terms)
            # recipe.Trainer.plain_loss: the basis-group mean loss on the same tokens, a reading here.
            codes_VTR = reader.calibrated(final_VTD) @ set_method.frame_DR
            code_loss = strength.mean_code_loss(codes_VTR, code_R.to(codes_VTR), median_norm**2).mean()
        overflow = (state_BCHW - state_BCHW.clamp(-1.0, 1.0)).abs().mean()
        loss = method_loss + OVERFLOW_WEIGHT * overflow
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        for parameter in rule.parameters():
            parameter.grad.div_(parameter.grad.norm() + 1e-8)
        gradients = torch.cat([parameter.grad.flatten() for parameter in rule.parameters()]).numpy()
        optimizer.step()
        for slot, entry in enumerate(drawn["entries"]):
            pool[entry] = state_BCHW[slot : slot + 1].detach()
        fine, coarse = kind.engine_layout(rule, state_BCHW)
        grown_norm = float(np.sqrt(np.square(fine.astype(np.float64)).sum()
                                   + (np.square(coarse.astype(np.float64)).sum() if coarse is not None else 0.0)))
        mean_codes = codes_VTR.detach().mean(1).flatten().tolist()
        method_record = {} if set_method is None else {"methodLoss": float(method_loss.detach()), "layerTerms": layer_terms}
        if before is not None:
            lockstep.append({
                "update": update, "plan": drawn, **before, "loss": float(loss.detach()), "codeLoss": float(code_loss.detach()),
                **method_record, "overflow": float(overflow.detach()), "meanCodes": mean_codes,
                **encoded_states(state_BCHW, "grownSample"), "gradients": encode(gradients),
            })
        records.append({
            "update": update,
            "plan": drawn,
            "learningRate": lr,
            "loss": float(loss.detach()),
            "codeLoss": float(code_loss.detach()),
            **method_record,
            "overflow": float(overflow.detach()),
            "stateMax": float(state_BCHW.detach().abs().max()),
            "meanCodes": mean_codes,
            # Every 257th value of the grown states in the engine's layout; 257 shares no factor
            # with the 16 channels or the grid rows, so every channel and column is sampled.
            # Each fc2 starts at zero, so update 0's grown states are its drawn starts.
            **encoded_states(state_BCHW, "grownSample"),
            "grownNorm": grown_norm,
            "gradients": encode(gradients),
            "values": encode(rule_values(rule)),
        })
        print(json.dumps({key: records[-1].get(key) for key in ("update", "loss", "methodLoss", "codeLoss", "overflow", "stateMax")}), flush=True)

    # Readouts of the live grid: the last trained rule, then any saved rules of the same kind,
    # whose winner fractions are far from zero.
    sources = [(f"oracle update {args.updates - 1}", rule, None)]
    for path in args.reading_rule:
        saved = kind.new_rule()
        saved.load_state_dict(torch.load(path, map_location="cpu", weights_only=True)["state_dict"])
        sources.append((f"{path.parent.name}/{path.name}", saved, hashlib.sha256(path.read_bytes()).hexdigest()))
    readings = []
    for name, source, digest in sources:
        reading = grow_and_read(kind, source, dino, model, request, request.frame_DR, direction_R, median_norm,
                                args.read_seed, args.read_ticks)
        readings.append({"rule": name, "ruleSha256": digest, "values": encode(rule_values(source)), **reading})
        print(json.dumps({"rule": name, "strength": reading["strength"], "winnerFraction": reading["winnerFraction"]}),
              flush=True)
    # The reference's own float32 error at update 0: the normalized gradient in float32 against
    # float64 on the same draws. The parity gate on the engine's gradient is three times this floor.
    if set_method is None:
        loss_32 = loss_64 = basis_group_mean_loss(kind, dino, model, request, code_R, median_norm)
    else:
        def loss_32(views_V3HW, dtype):
            return set_method.value(views_V3HW, kind.patches)[0]

        def loss_64(views_V3HW, dtype):
            # DINO is float64 by now: the set is read again in float64, so the floor covers its preparation too.
            reader_64 = givenset.reader.Reader("cpu", dino=AnyFloatReadout(dino), model=model)
            method_64 = SetMethod(args.method, layers, givenset, reader_64, block, windows_P3HW, dots, args.seed, dtype)
            return method_64.value(views_V3HW, kind.patches)[0]
    gradient_32 = first_gradient(kind, original, dino, args.seed, args.batch, starting, first, torch.float32, loss_32)
    gradient_64 = first_gradient(kind, original, dino, args.seed, args.batch, starting, first, torch.float64, loss_64)
    gradient_floor = float((gradient_32.double() - gradient_64).norm() / gradient_64.norm())
    recorded_0 = torch.from_numpy(np.frombuffer(base64.b64decode(records[0]["gradients"]), dtype="<f4").astype(np.float64))
    print(json.dumps({"gradientFloor": gradient_floor,
                      "recordVsFloat64": float((recorded_0 - gradient_64).norm() / gradient_64.norm())}), flush=True)
    set_record = None
    if set_method is not None:
        set_record = {
            "file": args.set.name,
            "sha256": hashlib.sha256(args.set.read_bytes()).hexdigest(),
            "sheetSha256": hashlib.sha256(args.set.with_name(set_file["sheet"]).read_bytes()).hexdigest(),
            **set_method.record(),
            "researchSetCheck": research_set_check(args.given_set, set_file, set_method.set_tokens),
        }
    fixture = {
        "format": 3,
        "purpose": "Figure-recipe parity: the archived trainer and the optimizer-schedule study's trainer driven by the engine's PCG draws "
                   "(tools/prepare_grow_recipe.py); the set methods with the given-set tool's Objective and Reader.",
        "request": {"block": block, "code": selected["code"], "medianNorm": median_norm, "seed": args.seed,
                    "batch": args.batch, "rule": args.rule, "start": args.start, "method": args.method,
                    **({"layers": list(layers)} if token_method else {})},
        **({"set": set_record} if set_record else {}),
        "direction": payload["request"]["u1"],
        "initialValues": encode(starting),
        # A continued record: the saved definition it starts from, and its first update.
        **({"fromUpdate": first, "continuedFrom": continued_from} if continued_from else {}),
        # Relative RMS of the first update's normalized gradient, float32 against float64, in the reference.
        "gradientFloor": gradient_floor,
        "updates": records,
        "lockstep": lockstep,
        "readings": readings,
        "provenance": {
            "archiveSha256": ARCHIVE_SHA256,
            "trainerSha256": hashlib.sha256((args.sweep / "trainer.py").read_bytes()).hexdigest(),
            **({"givenSet": given_set_provenance(args.given_set)} if set_method is not None else {}),
            "pyramidSha256": PYRAMID_SHA256,
            "inputSha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
            "strengthSha256": hashlib.sha256((args.strength / "strength.py").read_bytes()).hexdigest(),
            "oracleSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "reader": reader_identity,
            "torch": torch.__version__,
            "device": "cpu",
            "threads": torch.get_num_threads(),
            "loadSeconds": round(loaded - started, 1),
            "seconds": round(time.perf_counter() - started, 1),
        },
    }
    write_fixture(args.output, fixture)
    print(json.dumps({"output": str(args.output), "seconds": fixture["provenance"]["seconds"]}))


if __name__ == "__main__":
    main()
