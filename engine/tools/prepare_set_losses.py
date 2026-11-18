"""CPU reference for the target set's losses alone: the given-set tool's own PreparedLayer and
Objective on small token sets drawn from the engine's PCG streams, with their gradients. The
engine's `target_set` test (`cargo test --no-default-features --features cpu`) draws the same
tokens and compares, with no DINO and no model files.

Each case draws a set y [N, D] and canvas features x [M, D] from Stream(seed, purpose).at(case):
  y_nd = 4 (u - 0.5) + 2 (v_d - 0.5),   x_md = 3 (w - 0.5) + 0.25,
u, v and w the stream's uniforms at consecutive indices (the set first, then the offsets, then the
canvas). It records the prepared layers (mean, unit, median distance, widths, self-similarity),
the loss and its terms, and the gradient of the loss with respect to the raw x.

Usage: python engine/tools/prepare_set_losses.py --given-set <research/given-set> --output tools/fixtures/target-set-losses.json
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import types
from pathlib import Path

import numpy as np
import torch

from prepare_grow_recipe import Stream

PURPOSE = 0x73657473  # "sets"
SEED = 7
# (name, method kind, layers, N, M, D): token distribution over two layers, token mean, and
# basis-group distribution on three numbers, as the codes of `projection-mmd`.
CASES = (
    ("token-distribution", "mmd", ("block-3", "final"), 40, 24, 32),
    ("token-mean", "point", ("final",), 40, 24, 32),
    ("basis-group-distribution", "projection-mmd", ("final",), 40, 24, 3),
)


def encode(values: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(values, dtype="<f4").tobytes()).decode()


def draw(case: int, layer: int, count: int, members: int, width: int) -> tuple[np.ndarray, np.ndarray]:
    """The set [N, D] and the canvas [M, D] of one case's layer, from one stream."""
    stream = Stream.new(SEED, PURPOSE).at(case * 16 + layer)
    values = stream.uniform(count * width + width + members * width)
    set_ND = np.float32(4) * (values[: count * width].reshape(count, width) - np.float32(0.5))
    offsets_D = np.float32(2) * (values[count * width: count * width + width] - np.float32(0.5))
    canvas_MD = np.float32(3) * (values[count * width + width:].reshape(members, width) - np.float32(0.5)) + np.float32(0.25)
    return set_ND + offsets_D, canvas_MD


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--given-set", type=Path, required=True, help="the given-set tool, research/given-set")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(args.given_set.resolve()))
    from givenset import objective  # noqa: E402

    cases = []
    for index, (name, kind, layers, count, members, width) in enumerate(CASES):
        drawn = [draw(index, position, count, members, width) for position in range(len(layers))]
        config = objective.ObjectiveConfig(kind=kind, layers=layers)
        given = types.SimpleNamespace(tokens={"128": {layer: torch.from_numpy(set_ND) for layer, (set_ND, _) in zip(layers, drawn)}})
        projector = (lambda tokens: tokens) if kind == "projection-mmd" else None  # the features are already the codes
        prepared = objective.Objective(config, given, "128", seed=0, projector=projector)
        canvas = {layer: torch.from_numpy(canvas_MD)[None].requires_grad_(True) for layer, (_, canvas_MD) in zip(layers, drawn)}
        value, terms = prepared.value(canvas)
        value.backward()
        cases.append({
            "name": name,
            "kind": kind,
            "layers": list(layers),
            "tokens": count,
            "canvas": members,
            "width": width,
            "value": float(value.detach()),
            "terms": terms,
            "prepared": [{
                "layer": layer,
                "mean": encode(prepared.prepared[layer].mean_D.numpy()),
                "unit": float(prepared.prepared[layer].rms),
                "medianDistance": float(prepared.prepared[layer].median_distance),
                "widths": prepared.prepared[layer].widths.tolist(),
                "selfSimilarity": float(prepared.prepared[layer].yy),
            } for layer in layers],
            "gradients": [encode(canvas[layer].grad[0].numpy()) for layer in layers],
        })
        print(json.dumps({"case": name, "value": cases[-1]["value"]}))
    record = {
        "format": 1,
        "purpose": "The target set's losses alone: the given-set tool's PreparedLayer and Objective on PCG-drawn tokens "
                   "(tools/prepare_set_losses.py).",
        "seed": SEED,
        "purposeKey": PURPOSE,
        "cases": cases,
        "provenance": {"objectiveSha256": hashlib.sha256((args.given_set / "givenset" / "objective.py").read_bytes()).hexdigest(),
                       "torch": torch.__version__, "device": "cpu"},
    }
    args.output.write_text(json.dumps(record, indent=1) + "\n")


if __name__ == "__main__":
    main()
