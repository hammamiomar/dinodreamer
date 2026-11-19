# Continuous integration

The required GitHub status is `check`. It collects the plan, engine build, lint, type checks, web build and scheduled tests. A failed, cancelled or unexpectedly skipped job blocks the preview. Draft pull requests run the checks. Marking a pull request ready for review enables its preview.

## Local checks

Use Node 24 and the pnpm version in each project's `package.json`. Install the frozen dependencies in `app`, `gallery`, `engine` and `ci`. Restore the matching engine package to `engine/pkg`, or run `bash ci/build-engine.sh` to build it.

| Check | Command from the repository root |
| --- | --- |
| Lint first-party code | `pnpm --dir ci lint` |
| Check types | `bun check --no-script --all -p app` and `bun check --no-script --all -p gallery` |
| Bundle the app | `pnpm --dir app exec vite build` |
| Show all test shards | `node ci/test-plan.mjs --all` |
| Show the shards affected by committed changes | `node ci/test-plan.mjs <base-commit>` |
| Check selection rules | `node --test ci/test-plan.test.mjs` |
| Run one planned shard | Set `TEST_SHARD` to one entry of the plan's `jobs` array, then run `node ci/run-test-shard.mjs`. |
| Run Rust CPU tests | From `engine`, run `cargo test --locked --no-default-features --features cpu`. |
| Run the engine's Node tests | `node --test engine/tests/*.test.ts` |

CI pins Bun 1.4.4. It checks that Bun's embedded TypeScript version matches each project's locked compiler before checking code. The release workflow uses each project's existing build command. The planner, web validation and native Rust tests start together. Web validation restores or builds the engine, then runs lint alongside the exact type checks and Vite build. The planner runs a small unit selection on its own runner. Large timed shards start on separate runners as soon as the plan is ready. Unit tests mock the engine initializer. The bundle and browser tests use the generated package. The native job uses the pinned compiler with the CPU feature, debug assertions and source line tables.

Oxlint enables the `correctness`, `suspicious`, and `perf` rule categories, plus explicit language, React, accessibility, and test rules. The root configuration `.oxlintrc.json` groups each exception with its scope and reason. It excludes vendored Rust, generated packages, and local build output. Lint requires the engine declarations for type-aware rules.

## Test selection and timing

On a pull request, the planner compares the base commit to the checked-out merge result. Vitest resolves imports from each project to find affected tests, including tests that consume the other project’s source. The planner also accounts for setup files, source-tree scans, subprocess entry points and files read from disk. Changes to configuration, deleted code or unrecognized inputs can select the complete suite. For a complete suite the planner reads the same file patterns as Vitest and starts the shards without installing web dependencies. A regression test checks that the plan matches Vitest discovery. When a test starts reading a file outside its import graph, record that dependency in the planner and exercise it in the selection tests.

Each unit shard uses up to two workers. The planner assigns extra unit shards to the project with the most recorded work per shard. Each large shard starts Vitest once. A small change across projects can share one job. Within a suite, the planner assigns the longest remaining test to the lightest shard.

Browser tests run on pushes to main. Main also runs every unit suite and the Rust CPU tests. Test shards report measured durations per file. The How layout test reports one duration for each viewport. GitHub saves these measurements together after all shards pass. A later run uses this cache or starts from the measurements in `test-durations.json`. A new file receives its suite's median duration until main records it.

Browser tests start a local Vite server, serve a checked-in gallery entry and read library assets from the configured release. Install the matching browsers with `pnpm --dir gallery exec playwright-core install --with-deps chromium webkit`. A browser test can run directly, for example `node app/tests/run-browser-tests.mjs app/tests/home-browser.test.mjs`.

CI enables the material audits for the files in the repository. The three full-cloud audit tests also require the external exports named by `FULL_CLOUD_AUDIT` and `ATLAS_ASSETS`. Vitest reports those tests as skipped when the exports are absent.
