"""Make finite PyTorch reference fixtures from the pinned upstream encoder.

Two groups of fixtures go into one file:

- The encoder, one code target, shifted views, the pyramid and Adam (unchanged keys).
- `evidence-*`: the complete objective for tools/fixtures/evidence-recipe.json (format 5:
  painted fields, and the optimizer settings of release
  15: the step, the per-level rates and the robust view): reference decoding and readouts with
  the research implementation (`dinodreamer.render`), the Look terms' reference curves,
  every term in each view, the weighted total, pyramid gradients, one Adam update, probe
  codes and the protected-cell rebase. The painted Code and Appearance terms are computed
  here, in float64, as `PaintedLook` and `code_raw`; engine/src/objective.rs and curve.rs
  are the FP32 GPU implementation.
- `zoom-*`: the recipe's motion, which the research renderer does not have. The bilinear
  zoom of the evidence levels and base by 1 + ZOOM, then three updates of the evidence
  objective at ZOOM with fixed shifts, each followed by the zoom of every level and the base.

Reference previews are decoded from their 8-bit PNGs here, as in the browser, so both
sides of the comparison encode the same pixels. The research renderer encodes the FP32
view instead; that quantization difference is outside these fixtures.

The checkpoint may be the pinned converted .safetensors or Meta's original .pth: their
tensors are equal to the exported encoder files. Nothing here trains weights.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from safetensors.torch import load_file, save_file

LAYERS = (2, 5, 8, 11)
CELLS = 256
PREFIX = 5
ENCODER_ID = "dinov3-vitb16-pretrain-lvd1689m"
DICTIONARY_ID = "monet-dtd-seed9-20261004-pass-003"
ASSET_ID = "452ed7c3d3da3f1e26e5049db467eff46527627b37798e976d518b3da8105072"
CODE_IMAGE = 3106516868104010  # The source image of request 1's code; the legacy single-target fixture.
ZOOM = 0.01
# Padded crop starts of the three zoomed updates: shifts (+1, −2), (−1, +2), (+2, 0).
ZOOM_OFFSETS = ((3, 0), (1, 4), (4, 2))


COARSE_FIRST_RATES = (4.0, 2.83, 2.0, 1.41, 1.0)


def adam_for(levels: list[torch.Tensor], step: float, rates: tuple[float, ...]) -> torch.optim.Adam:
    """Adam with the recipe's step times each level's rate, the engine's optimizer settings."""
    return torch.optim.Adam([{"params": [level], "lr": step * rate} for level, rate in zip(levels, rates, strict=True)])


def load_checkpoint(path: Path) -> dict:
    if path.suffix == ".pth":
        return torch.load(path, map_location="cpu", weights_only=True)
    return load_file(path)


def decode_preview(path: Path) -> torch.Tensor:
    """[3, H, W] FP32 in [0, 1]; PIL ignores colour profiles, like the engine's decoder."""
    pixels = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255
    return torch.from_numpy(pixels).permute(2, 0, 1).contiguous()


def zoom(values_1CHW: torch.Tensor, scale: float) -> torch.Tensor:
    """Bilinear zoom about the centre by `scale`, with border padding: the engine's Zoom."""
    theta_123 = torch.tensor([[[1 / scale, 0.0, 0.0], [0.0, 1 / scale, 0.0]]])
    grid = F.affine_grid(theta_123, list(values_1CHW.shape), align_corners=False)
    return F.grid_sample(values_1CHW, grid, mode="bilinear", padding_mode="border", align_corners=False)


def legacy(model, release: Path, recipe: dict, saved: dict) -> None:
    """The original fixtures: encoder layers, one code target, views, pyramid and Adam."""
    calibration = load_file(release / "model" / DICTIONARY_ID / "calibration.safetensors")
    request = recipe["requests"][0]
    frame = load_file(release / "model" / DICTIONARY_ID / "blocks" / f"{request['block']:05d}.safetensors")["frame"]
    code = torch.tensor(request["respondLike"]["code"], dtype=torch.float32)
    rgb_mean = torch.tensor([0.485, 0.456, 0.406]).reshape(1, 3, 1, 1)
    rgb_std = torch.tensor([0.229, 0.224, 0.225]).reshape(1, 3, 1, 1)

    def encode(image_BCHW):
        result = model.forward_features((image_BCHW - rgb_mean) / rgb_std)
        return torch.cat(
            [result["x_norm_clstoken"][:, None], result["x_storage_tokens"], result["x_norm_patchtokens"]],
            dim=1,
        )

    def loss(tokens_BTD, region="whole"):
        slots_P = (
            torch.arange(5, 261)
            if region == "whole"
            else torch.tensor([5 + row * 16 + col for row in range(4, 12) for col in range(4, 12)])
        )
        codes_BPR = ((tokens_BTD[:, slots_P] - calibration["mean"]) * calibration["scale"]) @ frame
        return (codes_BPR - code).square().sum(-1).mean() / code.square().sum()

    previews = release / "web" / "v2" / "assets" / ASSET_ID / "previews"
    image_BCHW = decode_preview(previews / f"{CODE_IMAGE}.png")[None].requires_grad_(True)
    handles = [
        block.register_forward_hook(
            lambda _, args, out, layer=index: saved.update({f"layer-{layer:02d}": out[0].detach().clone()})
        )
        for index, block in enumerate(model.blocks)
    ]
    with torch.no_grad():
        saved["embedding"] = model.prepare_tokens_with_masks((image_BCHW - rgb_mean) / rgb_std)[0]
    tokens = encode(image_BCHW)
    image_loss = loss(tokens)
    image_loss.backward()
    saved.update(image=image_BCHW, tokens=tokens, image_gradient=image_BCHW.grad, loss=image_loss.reshape(1))
    for handle in handles:
        handle.remove()

    # Fixed offsets test reflection at the borders and the sum of gradients from
    # both views. These do not depend on matching the browser's random generator.
    for name, two_views, region in [
        ("whole-two-view", True, "whole"),
        ("center-one-view", False, "center"),
        ("center-two-view", True, "center"),
    ]:
        input_1CHW = image_BCHW.detach().clone().requires_grad_(True)
        views_VCHW = input_1CHW
        if two_views:
            padded_1CHW = F.pad(input_1CHW, (2, 2, 2, 2), mode="reflect")
            shifted_1CHW = padded_1CHW[:, :, 3:259, 0:256]  # row +1, column -2
            views_VCHW = torch.cat([input_1CHW, shifted_1CHW])
        if name == "whole-two-view":
            saved["fixed_views"] = views_VCHW.detach().clone()
        case_loss = loss(encode(views_VCHW), region)
        case_loss.backward()
        saved[f"{name}-loss"] = case_loss.reshape(1)
        saved[f"{name}-gradient"] = input_1CHW.grad.detach().clone()

    generator = torch.Generator().manual_seed(7)
    levels = [
        (0.05 * torch.randn(1, 3, side, side, generator=generator)).requires_grad_(True)
        for side in [16, 32, 64, 128, 256]
    ]
    adam = torch.optim.Adam(levels, lr=0.025)
    noise_image = torch.sigmoid(
        sum(F.interpolate(level, size=(256, 256), mode="bicubic", align_corners=False) for level in levels) / 5**0.5
    )
    noise_loss = loss(encode(noise_image))
    noise_loss.backward()
    saved["noise_image"] = noise_image
    saved["noise_loss"] = noise_loss.reshape(1)
    for side, level in zip([16, 32, 64, 128, 256], levels):
        saved[f"level-{side}"] = level.detach().clone()
        saved[f"gradient-{side}"] = level.grad.detach().clone()
    adam.step()
    for side, level in zip([16, 32, 64, 128, 256], levels):
        saved[f"updated-{side}"] = level.detach().clone()

    # Fixed-gradient Adam at the four public steps and both level profiles of release 15, three
    # updates from the noise levels with one gradient per level that covers the cases: positive,
    # negative, zero, near the epsilon and tiny. Identical gradients on both sides, so the check
    # isolates the update rule from the encoder's rounding.
    pattern = torch.tensor([1.0, -1.0, 0.0, 1e-8, -1e-12, 0.3, -0.05, 2.0])
    for side, level in zip([16, 32, 64, 128, 256], levels, strict=True):
        count = level.numel()
        saved[f"adam-grid-gradient-{side}"] = pattern.repeat(count // len(pattern) + 1)[:count].reshape(level.shape).contiguous()
    for step in (0.0125, 0.025, 0.05, 0.1):
        for profile, rates in (("even", (1.0,) * 5), ("coarse", COARSE_FIRST_RATES)):
            grid_levels = [saved[f"level-{side}"].clone().requires_grad_(True) for side in [16, 32, 64, 128, 256]]
            grid_adam = adam_for(grid_levels, step, rates)
            for _ in range(3):
                grid_adam.zero_grad()
                for side, level in zip([16, 32, 64, 128, 256], grid_levels, strict=True):
                    level.grad = saved[f"adam-grid-gradient-{side}"].clone()
                grid_adam.step()
            for side, level in zip([16, 32, 64, 128, 256], grid_levels, strict=True):
                saved[f"adam-grid-step-{step}-{profile}-{side}"] = level.detach().clone()

    for side in [3, 16, 32, 64, 128, 256]:
        array = torch.randn(1, 3, side, side, generator=generator, requires_grad=True)
        enlarged = F.interpolate(array, size=(256, 256), mode="bicubic", align_corners=False)
        upstream = torch.randn(enlarged.shape, generator=generator)
        (enlarged * upstream).sum().backward()
        saved.update(
            {
                f"resize-input-{side}": array,
                f"resize-output-{side}": enlarged,
                f"resize-upstream-{side}": upstream,
                f"resize-gradient-{side}": array.grad,
            }
        )
    print(json.dumps({"image_loss": image_loss.item(), "noise_loss": noise_loss.item()}))


def field(percentages: list[int]) -> tuple[list[int], torch.Tensor, float]:
    """A painted field: its painted cells, their masses p_c = W_c / ΣW (float64) and its peak max W_c / 100."""
    cells = [cell for cell in range(CELLS) if percentages[cell] > 0]
    total = sum(percentages[cell] for cell in cells)
    masses = torch.tensor([percentages[cell] / total for cell in cells], dtype=torch.float64)
    return cells, masses, max(percentages[cell] for cell in cells) / 100


def curve_table(sorted_MD: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """One reference window's curve as M + 1 linear segments (engine/src/curve.rs CurveTable).

    Segment k starts at 0 for k = 0 and at the knot (k − ½) / M after; segment 0 holds y_0, segment M
    holds y_{M−1}, segment k in between runs from y_{k−1} to y_k. Returns each segment's start value,
    slope and F = ∫₀^start Q, all [M + 1, D].
    """
    tokens = sorted_MD.shape[0]
    starts = [0.0] + [(k - 0.5) / tokens for k in range(1, tokens + 1)]
    lows = [0] + list(range(tokens))
    highs = [0] + [min(k, tokens - 1) for k in range(1, tokens + 1)]
    values_KD = sorted_MD[lows]
    slopes_KD = (sorted_MD[highs] - values_KD) * tokens
    prefixes_KD = torch.zeros_like(values_KD)
    for k in range(tokens):
        length = starts[k + 1] - starts[k]
        prefixes_KD[k + 1] = prefixes_KD[k] + values_KD[k] * length + slopes_KD[k] * length * length / 2
    return values_KD, slopes_KD, prefixes_KD


def prefix_integral(table: tuple[torch.Tensor, torch.Tensor, torch.Tensor], q_PD: torch.Tensor) -> torch.Tensor:
    """F(q) = ∫₀^q Q per channel at the mass coordinates `q_PD`, with the segment found arithmetically."""
    values_KD, slopes_KD, prefixes_KD = table
    tokens = values_KD.shape[0] - 1
    segment_PD = (q_PD * tokens + 0.5).floor().clamp(0, tokens).long()
    start_PD = ((segment_PD.double() - 0.5) / tokens).clamp_min(0.0)
    t_PD = q_PD - start_PD
    return prefixes_KD.gather(0, segment_PD) + values_KD.gather(0, segment_PD) * t_PD + slopes_KD.gather(0, segment_PD) * t_PD * t_PD / 2


def curve_at(sorted_MD: torch.Tensor, q: float) -> torch.Tensor:
    """Q(q) per channel: the midpoint rule as a continuous function of the mass coordinate."""
    tokens = sorted_MD.shape[0]
    u = min(max(q * tokens - 0.5, 0.0), tokens - 1)
    low = int(u)
    return sorted_MD[low] + (u - low) * (sorted_MD[min(low + 1, tokens - 1)] - sorted_MD[low])


def squared_integral(sorted_windows: list[torch.Tensor]) -> torch.Tensor:
    """∫₀¹ Q̄² per channel, Q̄ the mean of the windows' curves, exact over the union of their knots."""
    knots = sorted({0.0, 1.0} | {(k + 0.5) / window.shape[0] for window in sorted_windows for k in range(window.shape[0])})
    mean_at = lambda q: sum(curve_at(window, q) for window in sorted_windows) / len(sorted_windows)
    total = torch.zeros(sorted_windows[0].shape[1], dtype=torch.float64)
    end = mean_at(knots[0])
    for a, b in zip(knots, knots[1:]):
        start, end = end, mean_at(b)
        total += (b - a) * (start * start + start * end + end * end) / 3
    return total


class PaintedLook:
    """Appearance with a painted field (engine/src/objective.rs look_raw).

    Per layer and channel the painted cells, sorted by value with ties in cell order, occupy mass
    intervals of width p_c. The loss is ∫₀¹ (G − Q̄)² dq, G the sorted values on their intervals and Q̄ the
    mean of the references' curves, averaged over channels and the four layers and multiplied by the
    field's peak. In the form Σ p x² − 2 Σ x (F(B) − F(A)) + ∫Q̄² the gradient flows through the values
    only; the intervals are fixed by the order.
    """

    def __init__(self, readouts_LTD: list[torch.Tensor], windows: list[list[int]], percentages: list[int]):
        cells, self.masses_P, self.peak = field(percentages)
        self.positions_P = torch.tensor(cells)
        self.sorted = [
            [readout_LTD[layer][window].double().sort(dim=0).values for layer in range(len(LAYERS))]
            for readout_LTD, window in zip(readouts_LTD, windows, strict=True)
        ]
        self.tables = [[curve_table(sorted_MD) for sorted_MD in layers] for layers in self.sorted]
        self.squared = [squared_integral([layers[layer] for layers in self.sorted]) for layer in range(len(LAYERS))]

    def __call__(self, features: dict[int, torch.Tensor], view: int) -> torch.Tensor:
        per_layer = []
        for index, layer in enumerate(LAYERS):
            x_PD = features[layer][view, self.positions_P].double()
            sorted_PD, order_PD = torch.sort(x_PD, dim=0, stable=True)
            masses_PD = self.masses_P[order_PD]
            upper_PD = masses_PD.cumsum(0)
            lower_PD = upper_PD - masses_PD
            area_PD = sum(prefix_integral(tables[index], upper_PD) - prefix_integral(tables[index], lower_PD) for tables in self.tables) / len(self.tables)
            loss_D = (masses_PD * sorted_PD.square()).sum(0) - 2 * (sorted_PD * area_PD.detach()).sum(0) + self.squared[index]
            per_layer.append(loss_D.mean())
        return torch.stack(per_layer).mean() * self.peak


ROBUST_VIEW_SIGMA, ROBUST_VIEW_RADIUS = 1.0, 3


def optimizer_settings(recipe: dict) -> tuple[float, tuple[float, ...], bool]:
    """The recipe's optimizer (format 5): the step, one rate per level coarsest first, the robust view. Before format 5: 0.025, even, off."""
    choice = recipe.get("optimizer", {"step": 0.025, "scale": "even", "robustView": False})
    rates = COARSE_FIRST_RATES if choice["scale"] == "coarse" else (1.0,) * 5
    return choice["step"], rates, bool(choice["robustView"])


def blur_view(view_BCHW: torch.Tensor) -> torch.Tensor:
    """The robust view: a separable Gaussian of ROBUST_VIEW_SIGMA px with taps to ROBUST_VIEW_RADIUS, reflected
    borders (engine image::gaussian_coefficients), rows then columns."""
    taps = torch.arange(-ROBUST_VIEW_RADIUS, ROBUST_VIEW_RADIUS + 1, dtype=torch.float32)
    weights = torch.exp(-taps * taps / (2 * ROBUST_VIEW_SIGMA**2))
    weights = weights / weights.sum()
    channels = view_BCHW.shape[1]
    rows = F.conv2d(F.pad(view_BCHW, (0, 0, ROBUST_VIEW_RADIUS, ROBUST_VIEW_RADIUS), mode="reflect"), weights.reshape(1, 1, -1, 1).repeat(channels, 1, 1, 1), groups=channels)
    return F.conv2d(F.pad(rows, (ROBUST_VIEW_RADIUS, ROBUST_VIEW_RADIUS, 0, 0), mode="reflect"), weights.reshape(1, 1, 1, -1).repeat(channels, 1, 1, 1), groups=channels)


def active(term: dict) -> bool:
    return term["enabled"] and term["weight"] > 0


def evidence(model, release: Path, recipe: dict, saved: dict) -> None:
    """Every term of the evidence recipe on a fixed protected canvas, two fixed views, one Adam update."""
    from dinodreamer.dino import DinoReadout
    from dinodreamer.render.image import jitter_views, pyramid_from_image, pyramid_render
    from dinodreamer.render.objectives import image_priors, native_codes

    dino = DinoReadout(model, torch.device("cpu"))
    dictionary = release / "model" / DICTIONARY_ID
    calibration = load_file(dictionary / "calibration.safetensors")
    mean_D, scale = calibration["mean"], calibration["scale"].reshape(())
    previews = release / "web" / "v2" / "assets" / ASSET_ID / "previews"

    images = sorted(
        {reference["token"]["imageId"] for request in recipe["requests"] for reference in request["lookLike"]["references"]}
    )
    readouts = {}
    for image_id in images:
        pixels_CHW = decode_preview(previews / f"{image_id}.png")
        with torch.no_grad():
            readout_LTD = torch.cat(dino.patches(pixels_CHW[None], LAYERS))
        saved[f"evidence-pixels-{image_id}"] = pixels_CHW
        saved[f"evidence-readout-{image_id}"] = readout_LTD
        readouts[image_id] = readout_LTD

    # A fixed canvas: trainable noise levels and a different base, so protected cells differ.
    generator = torch.Generator().manual_seed(11)
    sides = (16, 32, 64, 128, 256)
    levels = [(0.05 * torch.randn(1, 3, side, side, generator=generator)).requires_grad_(True) for side in sides]
    base_levels = [0.05 * torch.randn(1, 3, side, side, generator=generator) for side in sides]
    base_1CHW = pyramid_render(base_levels).detach()
    editable_T = torch.tensor([not cell for cell in recipe["protect"]])
    editable_11HW = editable_T.reshape(16, 16).repeat_interleave(16, 0).repeat_interleave(16, 1)[None, None]
    image_1CHW = torch.where(editable_11HW, pyramid_render(levels), base_1CHW)
    offsets = (3, 0)  # Padded crop starts: row shift +1, column shift −2.

    def measured_slots(respond: dict) -> list[int]:
        """A prefix request measures its own slot; a patch request, the painted cells of its Respond like field."""
        slot = respond["source"]["slot"]
        return [slot] if slot < PREFIX else [PREFIX + cell for cell in range(CELLS) if respond["where"][cell] > 0]

    def code_raw(native_1TD, spec: dict) -> torch.Tensor:
        """Mass-weighted sum over the measured slots of ‖z_p − c‖², times the field's peak, divided by ‖c‖², in one view."""
        code_R = torch.tensor(spec["code"], dtype=torch.float32)
        codes_1PR = native_codes(native_1TD, torch.tensor([measured_slots(spec)]), frames[spec["block"]], mean_D, scale)
        errors_P = (codes_1PR[0] - code_R).square().sum(-1)
        if spec["source"]["slot"] < PREFIX:
            masses_P, peak = torch.ones(1, dtype=torch.float64), 1.0
        else:
            _, masses_P, peak = field(spec["where"])
        return (errors_P.double() * masses_P).sum() * peak / code_R.double().square().sum()

    frames = {
        request["block"]: load_file(dictionary / "blocks" / f"{request['block']:05d}.safetensors")["frame"]
        for request in recipe["requests"]
    }
    # Terms in the engine's order: per request Respond like then Look like; TV; L2.
    terms: list[tuple[str, float, object]] = []
    looks: list[PaintedLook] = []
    for request in recipe["requests"]:
        respond, look = request["respondLike"], request["lookLike"]
        spec = {"block": request["block"], **respond}
        if active(respond):
            terms.append((f"request:{request['id']}:respond", respond["weight"], ("code", spec)))
        if active(look):
            painted = PaintedLook(
                [readouts[r["token"]["imageId"]] for r in look["references"]],
                [[cell for cell in range(CELLS) if r["source"][cell]] for r in look["references"]],
                look["where"],
            )
            looks.append(painted)
            terms.append((f"request:{request['id']}:look", look["weight"], ("look", painted)))
    for name in ("tv", "l2"):
        if active(recipe["rules"][name]):
            terms.append((f"rules:{name}", recipe["rules"][name]["weight"], (name,)))

    step, rates, robust_view = optimizer_settings(recipe)

    def forward(image_1CHW: torch.Tensor, offsets: tuple[int, int]):
        """Every term in each of the two views of the image, [N, 2], with the views and readouts."""
        views_BCHW = jitter_views(image_1CHW, offsets)
        if robust_view:
            # The robust view: the shifted second view blurred before the encoder; view 0 stays sharp.
            views_BCHW = torch.cat((views_BCHW[:1], blur_view(views_BCHW[1:])), dim=0)
        patches, native_BTD = dino.patches_and_native(views_BCHW, LAYERS)
        features = dict(zip(LAYERS, patches, strict=True))

        def raw(kind: tuple, view: int) -> torch.Tensor:
            """One term in one view; positions are the same in both views under a ±2 pixel shift."""
            if kind[0] == "code":
                return code_raw(native_BTD[view : view + 1], kind[1])
            if kind[0] == "look":
                return kind[1](features, view)
            tv, l2 = image_priors(views_BCHW[view : view + 1])
            return tv if kind[0] == "tv" else l2

        raws_NB = torch.stack([torch.stack([raw(kind, view) for view in range(2)]) for _, _, kind in terms])
        return views_BCHW, features, native_BTD, raws_NB

    def weighted_total(raws_NB: torch.Tensor) -> torch.Tensor:
        return sum(weight * row.mean() for (_, weight, _), row in zip(terms, raws_NB, strict=True))

    views_BCHW, features, native_BTD, raws_NB = forward(image_1CHW, offsets)
    total = weighted_total(raws_NB)
    total.backward()
    saved["evidence-term-weights"] = torch.tensor([weight for _, weight, _ in terms])
    print(json.dumps({"evidence_terms": [name for name, _, _ in terms], "evidence_total": total.item()}))

    adam = adam_for(levels, step, rates)
    for side, level, base_level in zip(sides, levels, base_levels, strict=True):
        saved[f"evidence-level-{side}"] = level.detach().clone()
        saved[f"evidence-gradient-{side}"] = level.grad.detach().clone()
    adam.step()
    for side, level in zip(sides, levels, strict=True):
        saved[f"evidence-updated-{side}"] = level.detach().clone()
    for index, painted in enumerate(looks):
        for layer in range(len(LAYERS)):
            saved[f"evidence-squared-{index}-{layer}"] = painted.squared[layer].float()
            for reference, tables in enumerate(painted.tables):
                saved[f"evidence-prefix-{index}-{reference}-{layer}"] = tables[layer][2].float()
    for request in recipe["requests"]:
        slots = measured_slots(request["respondLike"])
        codes = native_codes(native_BTD[:1], torch.tensor([slots]), frames[request["block"]], mean_D, scale)
        saved[f"evidence-codes-{request['id']}"] = codes[0].detach()
    rebased = pyramid_from_image(image_1CHW.detach())
    saved.update(
        {
            "evidence-base": base_1CHW,
            "evidence-image": image_1CHW.detach(),
            # The painted terms are computed in float64; the fixtures are FP32 like the engine.
            "evidence-raws": raws_NB.detach().float(),
            "evidence-total": total.detach().float().reshape(1),
            "evidence-rebased-256": rebased[-1].detach(),
            "evidence-rebased-image": pyramid_render(rebased).detach(),
        }
    )

    # Motion, as Engine::descend applies it: Adam, then the zoom of every level and the base.
    zoom_scale = 1 + ZOOM  # Not `scale`: code_raw reads the calibration scale by that name.
    start_levels = [saved[f"evidence-level-{side}"] for side in sides]
    for side, level in zip(sides, start_levels, strict=True):
        saved[f"zoom-of-level-{side}"] = zoom(level, zoom_scale)
    saved["zoom-of-base"] = zoom(base_1CHW, zoom_scale)
    zoom_levels = [level.clone().requires_grad_(True) for level in start_levels]
    zoom_base_1CHW = base_1CHW.clone()
    zoom_adam = adam_for(zoom_levels, step, rates)
    for zoom_offsets in ZOOM_OFFSETS:
        zoom_image_1CHW = torch.where(editable_11HW, pyramid_render(zoom_levels), zoom_base_1CHW)
        zoom_adam.zero_grad()
        weighted_total(forward(zoom_image_1CHW, zoom_offsets)[3]).backward()
        zoom_adam.step()
        with torch.no_grad():
            for level in zoom_levels:
                level.copy_(zoom(level, zoom_scale))
            zoom_base_1CHW = zoom(zoom_base_1CHW, zoom_scale)
    for side, level in zip(sides, zoom_levels, strict=True):
        saved[f"zoom-updated-{side}"] = level.detach().clone()
    saved["zoom-image"] = torch.where(editable_11HW, pyramid_render(zoom_levels), zoom_base_1CHW).detach()


def main(source: Path, checkpoint: Path, research: Path, release: Path, recipe_path: Path, output: Path):
    sys.path.insert(0, str(source))
    sys.path.insert(0, str(research))
    from dinov3.hub.backbones import dinov3_vitb16

    torch.set_num_threads(8)
    with torch.device("meta"):
        model = dinov3_vitb16(pretrained=False, device="meta")
    model.load_state_dict(load_checkpoint(checkpoint), strict=True, assign=True)
    model = model.eval().requires_grad_(False)
    recipe = json.loads(recipe_path.read_text())
    saved = {}
    legacy(model, release, recipe, saved)
    evidence(model, release, recipe, saved)
    output.parent.mkdir(parents=True, exist_ok=True)
    save_file({name: tensor.detach().contiguous() for name, tensor in saved.items()}, output)
    print(json.dumps({"file": str(output), "tensors": len(saved)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, required=True, help="pinned facebookresearch/dinov3 checkout")
    parser.add_argument("--checkpoint", type=Path, required=True, help="DINOv3 ViT-B/16 .safetensors or .pth")
    parser.add_argument("--research", type=Path, required=True, help="the research repository's src/ directory")
    parser.add_argument("--release", type=Path, default=Path("local/release"), help="local release directory")
    parser.add_argument("--recipe", type=Path, default=Path("tools/fixtures/evidence-recipe.json"))
    parser.add_argument("--output", type=Path, default=Path("local/reference.safetensors"))
    args = parser.parse_args()
    main(args.source, args.checkpoint, args.research, args.release, args.recipe, args.output)
