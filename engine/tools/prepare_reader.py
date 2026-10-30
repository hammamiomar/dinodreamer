"""Pack the published native frames into bounded browser-reader chunks. CPU only."""

import argparse
import hashlib
import json
from pathlib import Path

import torch
from safetensors.torch import load_file, save_file


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dictionary", default="monet-dtd-seed9-20261004-pass-003")
    args = parser.parse_args()
    torch.set_num_threads(4)
    prefix = Path("model") / args.dictionary
    source = args.release / prefix / "blocks"
    destination = args.output / prefix
    destination.mkdir(parents=True, exist_ok=True)
    files = []
    for first in range(0, 16384, 512):
        frames_GDR = torch.stack([
            load_file(source / f"{block:05d}.safetensors")["frame"]
            for block in range(first, first + 512)
        ])
        if frames_GDR.shape != (512, 768, 3) or not frames_GDR.isfinite().all():
            raise ValueError(f"Invalid source frames at block {first}")
        frames_RD = frames_GDR.permute(0, 2, 1).reshape(512 * 3, 768).contiguous()
        name = f"reader-frames-{first:05d}.safetensors"
        target = destination / name
        save_file({"frames": frames_RD}, target)
        content = target.read_bytes()
        files.append({"firstBlock": first, "blocks": 512, "path": str(prefix / name),
                      "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    manifest = {"format": 1, "dictionaryId": args.dictionary, "blocks": 16384,
                "width": 768, "rank": 3, "files": files}
    (destination / "reader.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"output": str(destination), "chunks": len(files),
                      "bytes": sum(file["bytes"] for file in files)}))


if __name__ == "__main__":
    main()
