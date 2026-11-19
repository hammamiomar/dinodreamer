# DinoDreamer

DinoDreamer is a tool for seeing what [DINOv3](https://ai.meta.com/research/dinov3/), a vision model from
Meta, has learned. It reads DINOv3's patch tokens with a
[block sparse featurizer](https://arxiv.org/abs/2606.25234): 16,384 three-dimensional subspaces, called
basis groups. For a basis group, it trains a
[neural cellular automaton](https://distill.pub/2020/growing-ca/) that grows an image the group responds
to. DINOv3 and the featurizer stay frozen.

The automata run and train in the browser, on your own GPU, with WebGPU. What you make stays on your
device unless you publish it.

- **Site:** https://dinodreamer.computervision.vision
- **Write-up:** [Growing cellular automata to visualize DINOv3](https://computervision.vision/writing/dinodreamer/)
- **Featurizer:** [dinov3-vitb16-bsf-grassmannian-16384-rank3-k32](https://huggingface.co/hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32)
  on Hugging Face

## Repository

| Folder | Contents |
| --- | --- |
| `app/` | The browser app: Vite, React and TypeScript. |
| `engine/` | The numerical engine in Rust with Burn, compiled to WebAssembly: DINOv3, the featurizer, training and replay. |
| `gallery/` | The Cloudflare Worker that serves the site and the gallery, and the release scripts. |
| `ci/` | The scripts of the checks that run on a pull request. |

## Development

You need Node.js, pnpm 12, Rust through rustup (`engine/rust-toolchain.toml` sets the version), wasm-pack,
and a browser with WebGPU.

```sh
cd engine && pnpm install && pnpm build:engine
cd ../app && pnpm install
pnpm develop:remote     # the app, reading the public library
pnpm develop:fixtures   # the app with small local data: no GPU, no network
```

To check a change, run `pnpm check && pnpm test` in `app/` and in `gallery/`, and
`cargo test --no-default-features --features cpu` in `engine/`.

## Data and licenses

The code is under the Apache License 2.0 (`LICENSE`). `NOTICE` lists every third-party license.

The library of pictures, responses and model files is served from https://library.computervision.vision.
The DINOv3 weights are under the DINOv3 License.

## References

- [DINOv3](https://arxiv.org/abs/2508.10104), Siméoni et al., 2025
- [Vision Transformers Need Registers](https://arxiv.org/abs/2309.16588), Darcet et al., 2023
- [Structuring Sparsity: Block-Sparse Featurizers Capture Visual Concept Manifolds](https://arxiv.org/abs/2606.25234),
  Fel et al., 2026
- [A Deeper Analysis of Block-Sparse Featurizers](https://arxiv.org/abs/2608.27515), Jerpelea and Ananthram, 2026
- [MONET](https://arxiv.org/abs/2605.21272), Aubin et al., 2026, and
  [Describing Textures in the Wild](https://www.robots.ox.ac.uk/~vgg/data/dtd/), Cimpoi et al., 2014: the pictures
- [Growing Neural Cellular Automata](https://distill.pub/2020/growing-ca/), Mordvintsev et al., 2020
- [Self-Organising Textures](https://distill.pub/selforg/2021/textures/), Niklasson et al., 2021
- [NoiseNCA](https://arxiv.org/abs/2404.06279), Pajouheshgar et al., 2024
- [Feature Visualization](https://distill.pub/2017/feature-visualization/), Olah et al., 2017
- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/), Cho et al., 2024, and
  [Shared Geometry as a Rosetta Stone](https://dominik-schnaus.github.io/unpaired-rosetta/), Schnaus et al., 2026:
  the form of the How page
