// The fixed sizes of the models How draws (engine/src/encoder.rs, reader.rs, grow/figure.rs).
// Fixed model constraints, not settings.

/** DINOv3 ViT-B/16 on a 256 × 256 picture: the class token, four registers, 16 × 16 patches. */
export const PREFIX = 5;
export const PATCHES = 256;
export const TOKENS = PREFIX + PATCHES;
export const WIDTH = 768;
export const LAYERS = 12;
/** The BSF: 16,384 blocks of rank 3, 32 winners per token. */
export const BLOCKS = 16384;
export const RANK = 3;
export const WINNERS = 32;
