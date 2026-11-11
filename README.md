# Dinodreamer

Dinodreamer trains [neural cellular automata](https://distill.pub/2020/growing-ca/) against a
[block sparse featurizer](https://arxiv.org/abs/2606.25234) on [DINOv3](https://ai.meta.com/research/dinov3/).
The featurizer reads each DINOv3 ViT-B/16 patch token with 16,384 blocks of rank 3, called basis
groups. It keeps the 32 groups with the largest response. An automaton is one small learned rule
that runs in every cell of a grid. Training updates the rule until a chosen basis group is
selected on at least 90 % of the grown image's patches. DINOv3 and the featurizer stay frozen.

Everything runs in your browser, on your own GPU (WebGPU). The site serves shared data that
does not change. What you make stays on your device unless you publish it.

- Site: https://dinodreamer.computervision.vision
- How it works: https://dinodreamer.computervision.vision/how

## Pages

- **Index**: the 16,384 basis groups, each shown on pictures where it is selected.
- **Inspect**: one basis group: its responses in 3D, its levels, its pictures and its automata.
- **Train**: train an automaton on your device toward a reference patch of a basis group.
- **Automata**: every basis group that has automata. A group's screen shows the group's own patches by response
  level beside its automata, which are arranged by where they start and what their training asked for. The automata
  saved on your device have their own screen.
- **How it works**: the model, the featurizer and one automaton, on one picture.
- **Painter**: the project's first tool, an image editor, kept as an experiment.

## Repository

```text
app/       the browser app: Vite, React and TypeScript
engine/    the numerical engine in Rust with Burn, compiled to WebAssembly:
           DINOv3, the featurizer, training and replay
gallery/   the Cloudflare Worker: serves the site and the gallery; release scripts
```

## Run it

You need Node.js, pnpm 12, Rust through rustup (`engine/rust-toolchain.toml` sets the version),
wasm-pack, and a browser with WebGPU.

```sh
cd engine && pnpm install && pnpm build:engine
cd ../app && pnpm install
pnpm develop:remote     # the app, reading the public library
pnpm develop:fixtures   # the app with small local data: no GPU, no network
```

Checks: `pnpm check && pnpm test` in `app/` and `gallery/`, and
`cargo test --no-default-features --features cpu` in `engine/`.

## Data

The library (pictures, responses and model files) is served from
https://library.computervision.vision. The DINOv3 weights are under the DINOv3 License.
NOTICE lists every third-party license.

## References

Models and data

- Siméoni et al. [DINOv3](https://arxiv.org/abs/2508.10104). 2025. Code and weights:
  [facebookresearch/dinov3](https://github.com/facebookresearch/dinov3).
- Darcet et al. [Vision Transformers Need Registers](https://arxiv.org/abs/2309.16588). 2023.
- Fel et al. [Structuring Sparsity: Block-Sparse Featurizers Capture Visual Concept
  Manifolds](https://arxiv.org/abs/2606.25234). 2026. [Goodfire research
  page](https://www.goodfire.com/research/bsf-vision).
- Jerpelea and Ananthram. [A Deeper Analysis of Block-Sparse
  Featurizers](https://arxiv.org/abs/2608.27515). 2026.
- The released featurizer:
  [hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32](https://huggingface.co/hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32)
  on Hugging Face.
- Aubin et al. [MONET: A Massive, Open, Non-Redundant and Enriched Text-to-Image
  Dataset](https://arxiv.org/abs/2605.21272). 2026.
- Cimpoi et al. [Describing Textures in the Wild](https://www.robots.ox.ac.uk/~vgg/data/dtd/).
  CVPR, 2014.

Cellular automata

- Mordvintsev, Randazzo, Niklasson and Levin. [Growing Neural Cellular
  Automata](https://distill.pub/2020/growing-ca/). Distill, 2020.
- Niklasson, Mordvintsev, Randazzo and Levin. [Self-Organizing
  Textures](https://distill.pub/selforg/2021/textures/). Distill, 2021.
- Pajouheshgar, Xu and Süsstrunk. [NoiseNCA](https://arxiv.org/abs/2404.06279). 2024.

Interpretation and the How page

- Olah, Mordvintsev and Schubert. [Feature
  Visualization](https://distill.pub/2017/feature-visualization/). Distill, 2017.
- Cho et al. [Transformer Explainer](https://poloclub.github.io/transformer-explainer/).
  Polo Club, 2024. The form of the interaction on How.
- Schnaus et al. [Shared Geometry as a Rosetta
  Stone](https://dominik-schnaus.github.io/unpaired-rosetta/). 2026. The form of the How page.

## License

The code is under the Apache License 2.0 (LICENSE).
