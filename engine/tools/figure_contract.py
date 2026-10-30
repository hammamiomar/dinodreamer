"""The figure replay contract in numpy and torch, used to generate replay oracles.

app/src/replay/figure-reference.ts states the same contract in TypeScript; the WGSL runtime
follows it. The trainer is the archived reference (original_recipe.py), loaded read-only.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import torch

TRAINER_SHA256 = "5c10352e424989e1f423b8fa05745127e922ae3b98ab4410fea79225da516bdf"
NOISE_KEY, FIRE_KEY = 0x6E6F6973, 0x66697265
# The pyramid's coarse grid draws from its own streams ("cnoi", "cfir").
COARSE_NOISE_KEY, COARSE_FIRE_KEY = 0x636E6F69, 0x63666972
RULE_TENSORS = ("fc1.weight", "fc1.bias", "fc2.weight")
# The reference pyramid rule (research/2026-10-22-optimizer-schedule/pyramid.py), as stage 5 ran it, and its value order.
PYRAMID_SHA256 = "86434dfec7918a064a82078aa147e7a9c10202f161b7bf93af85856e4d2d2766"
PYRAMID_TENSORS = ("coarse.fc1.weight", "coarse.fc1.bias", "coarse.fc2.weight", "fc1.weight", "fc1.bias", "fc2.weight")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pcg(values: np.ndarray) -> np.ndarray:
    """PCG hash on uint32 arrays; numpy array arithmetic wraps modulo 2^32 like WGSL u32."""
    state = values.astype(np.uint32) * np.uint32(747796405) + np.uint32(2891336453)
    word = ((state >> ((state >> np.uint32(28)) + np.uint32(4))) ^ state) * np.uint32(277803737)
    return (word >> np.uint32(22)) ^ word


def unit(hashes: np.ndarray) -> np.ndarray:
    return (hashes >> np.uint32(8)).astype(np.float32) / np.float32(16777216)


def start_state(side: int, seed: int, start_disc: float = 0, noise_key: int = NOISE_KEY) -> torch.Tensor:
    """The replay's start; with start_disc > 0, zero outside the disc of that radius at the grid centre,
    as the stage-5 trainer's centre_disc (offsets c - side/2 + 0.5, dx^2 + dy^2 <= r^2)."""
    key = pcg(np.array([seed ^ noise_key], dtype=np.uint32))
    index = np.arange(side * side * 16, dtype=np.uint32)
    values_N = unit(pcg(key + index)) - np.float32(0.5)
    state_BCHW = torch.from_numpy(values_N.reshape(1, side, side, 16)).permute(0, 3, 1, 2).contiguous()
    if start_disc > 0:
        offsets_S = torch.arange(side) - side / 2 + 0.5
        disc_HW = offsets_S[:, None].square() + offsets_S[None, :].square() <= start_disc**2
        state_BCHW = state_BCHW * disc_HW
    return state_BCHW


def fire_mask(side: int, seed: int, tick: int, fire_rate: float, fire_key: int = FIRE_KEY) -> torch.Tensor:
    key = pcg(pcg(np.array([seed ^ fire_key], dtype=np.uint32)) + np.uint32(tick))
    cells = np.arange(side * side, dtype=np.uint32)
    fires_N = unit(pcg(key + cells)) < np.float32(fire_rate)
    return torch.from_numpy(fires_N.reshape(1, 1, side, side).astype(np.float32))


def cells_last(state_BCHW: torch.Tensor) -> np.ndarray:
    return state_BCHW[0].permute(1, 2, 0).contiguous().numpy()


def display_bytes(state_BCHW: torch.Tensor, pixels_per_cell: int = 1) -> np.ndarray:
    """The trainer's displayed picture: clamp(x + 0.5, 0, 1), upsampled bilinearly at 2 pixels per cell
    (the archive's picture_of), times 255, torch.round (half to even)."""
    rgb_13HW = (state_BCHW[:1, :3].float() + 0.5).clamp(0.0, 1.0)
    if pixels_per_cell != 1:
        rgb_13HW = torch.nn.functional.interpolate(rgb_13HW, scale_factor=pixels_per_cell, mode="bilinear", align_corners=False)
    return (rgb_13HW[0] * 255.0).round().byte().permute(1, 2, 0).contiguous().numpy()


def load_trainer(research: Path, bundle: Path):
    """The archived reference trainer, checked by hash and imported read-only."""
    trainer = research / "research/2026-10-22-objective-dynamics/original_recipe.py"
    if sha256(trainer) != TRAINER_SHA256:
        raise SystemExit(f"{trainer} is not the archived reference trainer")
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(bundle.resolve()), str((research / "src").resolve())]
    # Load the selected bundle before the archived module adds its historical search paths.
    __import__("bsf")
    spec = importlib.util.spec_from_file_location("original_recipe", trainer)
    original = importlib.util.module_from_spec(spec)
    sys.modules["original_recipe"] = original  # dataclasses look their module up while the file executes
    spec.loader.exec_module(original)
    return original


def load_saved(rule_path: Path, settings_path: Path | None = None) -> tuple[dict, dict]:
    """A rule file's weights and its run's record. A stage-6 rules/update-NNNN.pt holds only
    {updates, state_dict}; its settings, variant and rule kind are in the run's rule.pt. A
    selection-margin run has no rule.pt: its run.json records them under "identity"."""
    saved = torch.load(rule_path, map_location="cpu", weights_only=True)
    if settings_path and settings_path.suffix == ".json":
        identity = json.loads(settings_path.read_text())["identity"]
        return saved["state_dict"], {"rule": identity["rule"], "settings": identity["settings"]}
    record = torch.load(settings_path, map_location="cpu", weights_only=True) if settings_path else saved
    return saved["state_dict"], record


def load_rules(rule_path: Path, research: Path, bundle: Path, settings_path: Path | None = None):
    """The rule in float32 and float64, its settings, and its 7,776 values in the figure layout."""
    original = load_trainer(research, bundle)
    state_dict, record = load_saved(rule_path, settings_path)
    settings = record["settings"]
    if (settings["channels"], settings["hidden"], settings["init"]) != (16, 96, "noise"):
        raise SystemExit("The figure layout needs a 16-channel, 96-hidden rule trained from noise")
    rule32 = original.CellRule(16, 96)
    rule32.load_state_dict(state_dict)
    rule64 = original.CellRule(16, 96).double()
    rule64.load_state_dict(state_dict)
    values = torch.cat([state_dict[name].reshape(-1) for name in RULE_TENSORS]).numpy().astype("<f4")
    if values.size != 7776:
        raise SystemExit(f"Expected 7,776 rule values, found {values.size}")
    return rule32, rule64, settings, values


def load_pyramid(rule_path: Path, research: Path, bundle: Path, pyramid_path: Path, settings_path: Path | None = None):
    """PyramidRule in float32 and float64 with a stage-5 or stage-6 rule's weights, its settings,
    and its 17,088 values in the pyramid layout. pyramid.py is checked by hash and imported read-only."""
    load_trainer(research, bundle)  # pyramid.py imports original_recipe
    if sha256(pyramid_path) != PYRAMID_SHA256:
        raise SystemExit(f"{pyramid_path} is not the pyramid rule of stage 5")
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("pyramid", pyramid_path)
    pyramid = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pyramid)
    state_dict, record = load_saved(rule_path, settings_path)
    if record.get("rule") != "pyramid":
        raise SystemExit("Expected a rule.pt of the pyramid")
    rule32 = pyramid.PyramidRule(16, 96)
    rule32.load_state_dict(state_dict)
    rule64 = pyramid.PyramidRule(16, 96).double()
    rule64.load_state_dict(state_dict)
    values = torch.cat([state_dict[name].reshape(-1) for name in PYRAMID_TENSORS]).numpy().astype("<f4")
    if values.size != 17088:
        raise SystemExit(f"Expected 17,088 pyramid values, found {values.size}")
    return rule32, rule64, record["settings"], values


DAMAGE_KEY = 0x64616D67


def torus_distance(side: int, cx: float, cy: float) -> torch.Tensor:
    """Each cell's distance to (cx, cy) on the torus, [side, side] (rows y, columns x)."""
    coordinates = torch.arange(side, dtype=torch.float32)
    dx = (coordinates[None, :] - cx).abs()
    dy = (coordinates[:, None] - cy).abs()
    dx, dy = torch.minimum(dx, side - dx), torch.minimum(dy, side - dy)
    return torch.sqrt(dx * dx + dy * dy)


def damage_noise(side: int, seed: int, count: int) -> torch.Tensor:
    """The damage stream's fresh start-distribution values for every state value, [1, 16, side, side]."""
    key = pcg(pcg(np.array([seed ^ DAMAGE_KEY], dtype=np.uint32)) + np.uint32(count))
    index = np.arange(side * side * 16, dtype=np.uint32)
    values_N = unit(pcg(key + index)) - np.float32(0.5)
    return torch.from_numpy(values_N.reshape(1, side, side, 16)).permute(0, 3, 1, 2).contiguous()


GREY_AMPLITUDE = 0.1


def damage_grey(state_BCHW: torch.Tensor, seed: int, count: int, cx: float, cy: float, radius: float) -> torch.Tensor:
    """The grey brush: the 13 hidden channels get the start distribution; R, G and B all get one
    shared low-amplitude value per cell, 0.2 x the cell's red start value (in [-0.1, 0.1)), which
    shows as grey static around mid-grey; both blend in across a smoothstep edge a quarter of the radius wide."""
    side = state_BCHW.shape[-1]
    distance_HW = torus_distance(side, cx, cy)
    edge = max(radius / 4, 1.0)
    t_HW = ((radius - distance_HW) / edge).clamp(0, 1)
    weight_HW = t_HW * t_HW * (3 - 2 * t_HW)
    target_BCHW = damage_noise(side, seed, count).to(state_BCHW.dtype)
    grey_HW = 2 * GREY_AMPLITUDE * target_BCHW[0, 0]
    target_BCHW[0, :3] = grey_HW.expand(3, side, side)
    return state_BCHW + weight_HW * (target_BCHW - state_BCHW)
