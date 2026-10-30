# Local patch of cubecl-wgpu 0.11.0

This is the crates.io release of `cubecl-wgpu` 0.11.0 with one change, applied through
`[patch.crates-io]` in `engine/Cargo.toml`.

**Problem.** The runtime picks system timing when the adapter lacks the WebGPU feature
`timestamp-query` (`runtime.rs`, `try_create_server`). Upstream, creating a stream with
system timing panics on WASM (`Timings::system`), so the engine could not load at all on
such an adapter, although the public build never profiles: the engine's own profiling is
harness-only and burn's autotune is off.

**Change** (`src/compute/stream.rs`). `Timings::system` no longer panics. The panic moves
to `start_profile` and `end_profile` on the system-timing path (`refuse_wasm_system_profile`):
a profile on WASM still needs `timestamp-query`; loading and training do not.

Remove this folder and the patch entry when an upstream release creates streams without
the panic.
