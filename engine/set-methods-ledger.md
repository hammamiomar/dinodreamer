# Set methods in the engine: measurements and ledger

Date: 17 November 2026. Branch: `engine-set-objectives`. Brief: `project-management/design/train-four-methods-2026-11-17.md`
in the research repository. This file records the evidence for the engine's three set methods. It is dated evidence,
not a checklist.

## What the engine does

A figure request names its method. The default is basis-group mean matching, so every earlier request, kept file and
fixture keeps its meaning. The three set methods compare the canvas with a target set:

| Method | Research kind | Loss, per compared layer, then the mean over the layers |
|---|---|---|
| Token mean | `point` | ‖mean_m x̂_m‖² on the request's layers |
| Basis-group distribution | `projection-mmd` | unbiased MMD² on the codes z = Fᵀc, final layer |
| Token distribution | `mmd` | unbiased MMD² on the request's layers |

Symbols. x_m, m = 1..M, are the canvas features: the scored patches of all 8 views. The centre disc scores the central
4 × 4 patches (M = 128). Noise scores all 64 (M = 512). ŷ_n, n = 1..N, are the set's features: the 3 × 3 tokens around
the patch in each picture's aligned 128 px window (N ≤ 297 for 33 pictures). A layer's features are DINO's tokens
(D = 768) or the block's codes (D = 3). Both are standardized by the set's mean μ and unit σ, fitted once per set.
The kernel is the mean of four Gaussians at 0.5, 1, 2 and 4 times the set's median pairwise distance. The
self-similarity E k(ŷ, ŷ') is fixed at preparation. `src/grow/figure/target_set.rs` gives every formula.

The engine prepares a set once per method, layers and group, and reuses it for every seed. The WebAssembly entry points
are `prepare_figure_set` (preview PNGs and patches), `create_figure_on_set` and `create_figure_continued_on_set`.

## Predictions and measurements

The predictions were written in the brief before any run. The measurements are on the M1 Max, group 12002, the pyramid
rule, batch 4, with the final code, natively (WGPU on Metal, `examples/set_methods_timing.rs`) and in Chrome 156's
WebGPU through the WebAssembly entry points (`benchmarks/set-methods-in-chrome.ts`). Time per update is paired: one
process trains every method from one seed, in turns, so update i has the same rollout length in every method; the first
turn is warm-up. The ratio is the median over the update indices of a method's time divided by basis-group mean's time.

| Quantity | Prediction | Native WGPU | Chrome WebGPU |
|---|---|---|---|
| Time per update against basis-group mean, centre disc | Within 10 % | Token distribution 1.017, basis-group distribution 1.009, token mean 1.006 (final) and 1.008 (four layers); 60 pairs each | 1.014, 1.002, 1.009 and 1.027; 30 pairs each |
| The same, noise start (M = 512) | Within 10 % | Token distribution 1.025; 40 pairs | 1.049; 24 pairs |
| The same, batch 1, centre disc | Not predicted | Token distribution 1.038; 40 pairs | 1.026; 24 pairs |
| Basis-group mean's own time per update | Not predicted | 0.38 s (batch 4), 0.13 s (batch 1) | 0.41 s and 0.14 s in this session; 0.34 to 0.50 s across sessions |
| Preparation of the set: 33 windows through DINO | Under 5 s on an M1 Max | 0.18 s; 0.32 s with the first kernel compilation | 0.24 s; 0.52 to 1.63 s with the first compilation, PNG decoding included |
| Added GPU memory, token distribution at four layers | Under 50 MB | +3.5 MB in use after an update (the set's tensors); +90 MB reserved by the pool, at most +112 MB, from the centre disc and from noise alike | Not measured |

The memory prediction holds for the memory in use but not for the pool's reservation. The four layers cause it: token
mean at four layers reserves the same, and the final-layer methods reserve 9 MB more than basis-group mean. The peak in
use during an update is not measured; the hypothesis is that the extra activations of the three intermediate layers
(about 10 MB) open new pool pages.

Before ledger entry 2, token distribution cost 1.286 to 1.345 in Chrome, 1.024 natively from the centre disc, 1.077
from noise and 1.106 at batch 1.

## Parity

The CPU oracle (`tools/prepare_grow_recipe.py --method`) drives the given-set tool's own `Objective` and `Reader` with
the engine's random draws, on windows fixed as raw pixels (`tools/fixtures/target-set-12002-pole-3x3.png`, the research's
set `block-12002-pole-3x3`). The oracle's set tokens equal the research's saved set exactly (relative error 0 at all four
layers). The parity example (`examples/grow_recipe_parity.rs`) gates update 0; later updates are reported.

| Fixture (group 12002, pyramid) | Loss | Layer terms | Gradients (tolerance: 3 × the oracle's float32 floor) |
|---|---|---|---|
| Token distribution, centre disc | 2.7e-7 | 9.0e-6 | 4.0e-4 (9.9e-3) |
| Token distribution, noise | 0 | 2.1e-6 | 3.2e-3 (1.3e-2) |
| Basis-group distribution, centre disc | 1.8e-7 | 2.5e-7 | 1.4e-3 (2.4e-2) |
| Token mean, final layer, centre disc | 0 | 0 | 4.8e-4 (1.1e-2) |
| Token mean, four layers, centre disc | 1.6e-7 | 3.9e-7 | 4.9e-4 (1.0e-2) |

Loss and layer terms are relative errors; gradients are relative RMS of the normalized gradient. The gate on the loss and
on each layer term is 1e-4. The prepared set (unit, median distance, self-similarity, mean, standardized tokens) agrees
within 8.1e-6 on WGPU and within 7.8e-6 on the CPU build (`examples/target_set_check.rs`). The losses alone agree with
the research's functions on the CPU within 7.4e-6 for values and 4.3e-7 for gradients (`tools/prepare_set_losses.py`,
the test `research_losses` in `target_set.rs`). The ten basis-group mean fixtures still pass.

## The set's source and pixels

`tools/audit_target_sets.py` compares the browser's set with the research's on six groups. Both take the 33 strongest
distinct public pictures by code norm. The research takes them from the 4,096-row public sample frozen in each group's
input file. The strongest file holds the top 1,024 rows of the whole cloud.

| Group | Shared pictures of 33 | Identical patches | Norms, research's set | Norms, strongest file's set |
|---|---|---|---|---|
| 12002 | 15 | 2 | 13.0 to 17.6 | 16.1 to 21.0 |
| 7178 | 30 | 11 | 9.5 to 12.8 | 9.6 to 12.9 |
| 7705 | 18 | 2 | 11.6 to 14.4 | 12.7 to 15.4 |
| 4009 | 27 | 2 | 12.0 to 14.6 | 12.7 to 15.4 |
| 2568 | 30 | 13 | 8.7 to 12.0 | 8.9 to 12.3 |
| 13633 | 8 | 0 | 13.5 to 16.1 | 15.8 to 16.9 |

The research's sample is published: `clouds/<block>.json` in the readouts publication is byte-identical to the frozen
sample (SHA-256 equal for 13633 and 12002). The app already reads and decodes this file for the Index (`LookFixture`),
in row order. It is 823 KB, 255 KB compressed. So the browser can take the research's 33 with the same rule: public rows,
a stable sort by norm, descending, the first row of each distinct picture, the first 33. Which set the browser uses is
Omar's decision.

Pixels. No picture of the six strongest-file sets lacks a PNG preview (0 of 198). Every preview is 256 × 256, 8-bit RGB,
with no gamma or colour-profile chunk, so the engine's PNG decoder and PIL give the same bytes. The tolerance on the
windows is 0.

Cloud check (the research's, as an explicit audit): the code recomputed at the patch of the 256 px picture against the
cloud row's code. 0 of 198 pictures fail (5 % norm error, 0.98 cosine). The median norm error is 0.12 % to 0.22 % per
group, the worst 1.1 %, and the worst cosine 0.9999.

## Ledger

Each entry is a change that was measured, with the measurement that decided it. Chrome measurements are paired
within one session (Chrome 156, M1 Max): the ratio is to basis-group mean on the same update indices. Across sessions
Chrome's base time per update moved between 0.34 and 0.50 s, so only ratios within a session compare.

Adopted:

1. The losses as plain Burn operations on autodiff, with no custom kernel. Autodiff differentiates them on WGPU and in
   Chrome's WebGPU.
2. The products with a fixed operand on the engine's own `frozen_linear` kernel instead of Burn's generic `matmul`.
   First x̂ ŷᵀ (the set is fixed): token distribution in Chrome went from 1.345 to 1.205. Then x̂ x̂ᵀ by its symmetry:
   the distances d_ij are symmetric, so the gradient through the second operand equals the one through the first; the
   second is detached and the gradient doubled (2g − stop(g)). Chrome went from 1.205 to 1.018. The gradient still
   matches the research's full autograd on the CPU within 4.3e-7. Natively the generic product was not slow; in Chrome
   it cost about 25 ms per layer and update.
3. The four kernel widths in one expression, as the research writes it, with −2w² and ‖ŷ_n‖² fixed at preparation.
   It cut the dispatches that token distribution adds from 572 to 436 per update, but not the time (1.335, then 1.345
   in the next session). It stays because it is the research's form and is shorter.
4. The off-diagonal mask of E k(x̂, x̂') made on the device (`arange`, `not_equal`): no M × M upload per layer and
   update (1 MB at M = 512). The mask removes the diagonal's gradient, as the research's subtraction does.
5. One set per method, layers and group, prepared once and shared by every seed of a run.
6. The engine decodes the preview PNGs itself (`assets::decode_preview`): the windows are byte-identical to the
   research's.
7. The cloud check as an explicit audit, not in the routine path: 0 failures in 198 pictures, against 33 more DINO
   passes at 256 px in every preparation.
8. One readback per update: the method's terms join the existing readings in one tensor (`FigureReadings`).

Rejected or refuted:

1. The dispatch count as the cause of Chrome's cost. The isolation pointed at the MMD (four layers 1.286, final layer
   only 1.065, token mean at four layers 1.010), and the MMD adds 122 dispatches per layer. But 136 fewer dispatches
   (adopted 3) saved no time; the generic matmul (adopted 2) was the cost.
2. A Chrome CPU profile: profiling slowed an update about seven times, and the WebAssembly function names it reported
   could not be hot (`inventory::Registry::submit`, `__wasm_call_ctors`). The paired A/B measurements decided instead.
3. A fused MMD kernel: after adopted 2 the loss costs about 2 % of an update in Chrome; nothing is left to win.
4. Drawing 1,024 set tokens per update for larger sets, as the research does: the engine's sets hold at most 297
   tokens, and it refuses more than 1,024.

## Full trainings

One run per method on group 12002 and two token-distribution runs on group 13633, on the M1 Max, native WGPU: the
pyramid rule, the centre disc, batch 4, seed 0, 1,000 updates (`examples/grow_recipe_train.rs`, 0.40 to 0.49 s per
update). Each rule was read every 250 updates on the replay grid (seed 9317) at ticks 200, 600 and 2,000. The runs used
the code before ledger entries 2 and 3; those change only rounding (parity unchanged), so a run with the final code
differs only as two seeds' draws would. The pictures, logs and rules are in the evidence archive,
`dinodreamer-evidence-archive/2026-11-17-set-methods/` (with SHA256SUMS).

The final rules' readings: the share of the 16 central patches where the group is selected, then the strength in units
of the median norm.

| Run | Tick 200 | Tick 600 | Tick 2,000 | By eye, ticks 200 to 2,000 |
|---|---|---|---|---|
| 12002 basis-group mean | 1.00, 2.94 | 1.00, 2.38 | 0.44, 1.01 | A saturated orange and white eye on a violet field |
| 12002 token mean, final layer | 1.00, 2.59 | 0.75, 1.14 | 0.00, 0.20 | A small yellow eye on a dark field, then yellow and pink stripes |
| 12002 token mean, four layers | 1.00, 2.28 | 0.88, 1.37 | 0.06, 0.58 | A cartoon eye, white with a black pupil, then stripes |
| 12002 basis-group distribution | 0.56, 1.21 | 0.00, -0.24 | 0.00, 0.10 | A saturated blue blob, then a blue field |
| 12002 token distribution | 1.00, 2.24 | 0.00, 0.47 | 0.00, 0.38 | A cartoon eye in natural colours, pale by 600, bands by 2,000 |
| 13633 token distribution, research's set | 0.81, 1.36 | 1.00, 1.82 | 0.56, 1.21 | Skin and eyebrows, which hold to 2,000 |
| 13633 token distribution, strongest file's set | 0.75, 1.48 | 1.00, 1.30 | 0.00, 0.16 | Forehead skin and one brow, a flat skin-coloured field by 2,000 |

The research's caveat holds: with token distribution matching the 12002 figure is clearest near tick 200 and fades. At
update 1,000 it has faded by tick 600, which the site reads; at update 750 it still read 0.75 there. The product answer
is Omar's. On 13633 the two sets give different pictures from the same seed: the research's set grows eyebrows, the
strongest file's set grows forehead skin. A single seed per set separates them by eye only, not as a measured effect.

## Evening studies for the decisions of 17 November (12, 16, 17)

The outputs, pictures and sheets are in the evidence archive's folder, under `reading-step/`, `token-mean-depth/` and
`chosen-sets/`.

### The reading step (decision 12)

Each final rule above was read on the replay grid at ticks 100 to 2,000 (`examples/reading_step_study.rs`). At each
tick the study records the run's own loss on that one picture (`figure::own_loss`: the training's terms with the picture
in place of the eight views, on the 16 scored patches) and the site's reading. The lowest own loss picked tick 150 to
400 and landed on a clear figure in all seven runs. The highest selection share often tied at 1.00, and the tie-break by
strength then favoured the earliest ticks. Omar chose the own loss. `figure_own_loss` takes about 21 ms per reading in
Chrome and 22 to 25 ms natively, after a first reading that compiles the kernels (0.6 s). Chrome agrees with native
within 2e-6.

### Depth of token mean (decision 16)

Token mean at the final layer and at four layers, seeds 0 to 2, on group 12002 (cartoon eyes) and group 4009 (hibiscus),
with the research's 33 strongest as the set and the recipe above. The seed-0 runs of 12002 are the full trainings above.
At each run's step:

| Run | Final layer: step, selected, strength | Four layers: step, selected, strength |
|---|---|---|
| 12002, seed 0 | 400, 1.00, 1.86 | 200, 1.00, 2.28 |
| 12002, seed 1 | 200, 1.00, 3.37 | 300, 1.00, 2.38 |
| 12002, seed 2 | 100, 1.00, 2.50 | 300, 1.00, 2.70 |
| 4009, seed 0 | 150, 0.81, 1.71 | 200, 1.00, 2.47 |
| 4009, seed 1 | 150, 1.00, 1.89 | 200, 1.00, 2.30 |
| 4009, seed 2 | 100, 0.94, 1.43 | 200, 1.00, 2.14 |

By eye, all six four-layer runs show the subject in natural colours at their step: three cartoon eyes and three hibiscus
flowers. The final-layer runs show the same subjects in saturated colours, and on 4009 they turn into flat fields by
tick 400. Four layers holds as the default.

### Basis-group distribution on a chosen set (decision 17)

Groups 7178 and 12240, seed 0, three sets each from the frozen sample by decision 14's rule (`export_target_set.py
--selection`): the 33 strongest, Level 2, and the lobe farthest from the strongest set (7178 lobe 1, 12240 lobe 2).

| Set | What it holds | What grows (step: selected, strength) |
|---|---|---|
| 7178, 33 strongest | Red and white checked headdresses | Saturated yellow bands (150: 0.75, 1.12) |
| 7178, Level 2 | White headdresses | An almost empty pale field (100: 0.00, 0.40) |
| 7178, lobe 1 | Headlights, drill bits, glossy car bodies | A white glossy shape (150: 0.12, 0.20) |
| 12240, 33 strongest | Blue tits, great tits | A tit's head, black cap and white cheek (100: 1.00, 1.71) |
| 12240, Level 2 | The same birds, weaker | The same head (300: 1.00, 1.54) |
| 12240, lobe 2 | Chipmunks, badgers, striped heads | Black and yellow stripes (200: 0.69, 0.97) |

The picture follows the set: a lobe with other content grows other content. One seed per set, so this is a difference
by eye. The selection share falls as the set leaves the group's strongest direction, because it measures the group,
not the set.
