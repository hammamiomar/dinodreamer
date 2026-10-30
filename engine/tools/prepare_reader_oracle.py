"""Read one displayed image with the frozen native DINO/dictionary on CPU."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("e1", type=Path)
parser.add_argument("image", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
sys.path.insert(0, str(args.e1.resolve()))
from run import load_local_reader  # noqa: E402

torch.set_num_threads(4)
image = Image.open(args.image).convert("RGB")
if image.size != (256, 256):
    raise ValueError("The oracle reads the displayed 256 by 256 crop, without resizing")
dino, model = load_local_reader(torch.device("cpu"))
image_HWC = np.array(image)
image_BCHW = torch.from_numpy(image_HWC).permute(2, 0, 1).unsqueeze(0).float() / 255
with torch.no_grad():
    tokens_TD = model.calibrate(dino.native_tokens(image_BCHW)[0, 5:])
    codes_TGR = torch.einsum("td,gdr->tgr", tokens_TD, model.frames_GDR)
    norms_TG = codes_TGR.square().sum(-1).sqrt()
    # Stable sort preserves the lower block id when lengths are equal.
    order_TG = norms_TG.argsort(dim=-1, descending=True, stable=True)
    blocks_TK = order_TG[:, :32]
    codes_TKR = codes_TGR.gather(1, blocks_TK.unsqueeze(-1).expand(-1, -1, 3))
    norms_TK = norms_TG.gather(1, blocks_TK)
    margins_T = norms_TK[:, -1] - norms_TG.gather(1, order_TG[:, 32:33])[:, 0]
args.output.mkdir(parents=True, exist_ok=True)
blocks_TK.numpy().astype("<u2").tofile(args.output / "blocks.u16")
codes_TKR.numpy().astype("<f4").tofile(args.output / "codes.f32")
norms_TK.numpy().astype("<f4").tofile(args.output / "norms.f32")
image.convert("RGBA").save(args.output / "image.png")
np.array(image.convert("RGBA")).tofile(args.output / "image.rgba")
metadata = {"image": str(args.image), "imageSha256": hashlib.sha256(args.image.read_bytes()).hexdigest(),
            "torch": torch.__version__, "device": "cpu", "patches": 256, "blocks": 16384,
            "topK": 32, "minimumBoundaryMargin": float(margins_T.min()),
            "nativeIdentity": dino.native_identity, "gain": "none"}
(args.output / "inputs.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps(metadata))
