import type {
  BenchmarkEvent,
  BrowserResult,
  ModeResult,
} from "./protocol.ts";
import type { ServedRequest } from "./server.ts";
import { isDeepStrictEqual } from "node:util";

export interface Report {
  schema: 1;
  label: string;
  createdAt: string;
  build: { revision: string; dirty: boolean; changes: string; mode: "release" };
  environment: {
    browserVersion: string;
    headless: boolean;
    platform: string;
    arch: string;
    gpuDevices: unknown[];
    gpuFeatures: Record<string, string>;
    cpuProfiling?: boolean;
  };
  browser?: BrowserResult;
  events: BenchmarkEvent[];
  requests: ServedRequest[];
  errors: string[];
  browserConsole?: { type: string; message: string }[];
}

export function statistics(values: number[]) {
  if (
    !values.length ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error(
      "Timing samples must be finite, nonnegative, and nonempty.",
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length,
    median,
    p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
  };
}

export function compareReports(previous: Report, current: Report): string[] {
  const reasons: string[] = [];
  for (const [name, report] of [
    ["previous", previous],
    ["current", current],
  ] as const) {
    if (
      report.schema !== 1 ||
      report.errors.length ||
      report.browser?.error ||
      !report.browser?.qualification?.passed
    ) {
      reasons.push(`${name} run is incomplete or did not pass qualification`);
    }
  }
  const left = previous.browser?.performanceLoad;
  const right = current.browser?.performanceLoad;
  if (previous.environment.cpuProfiling || current.environment.cpuProfiling)
    reasons.push("CPU sampling enabled (diagnostic run)");
  if (!left || !right) reasons.push("missing performance load metadata");
  if (!left?.optimizer || !right?.optimizer) reasons.push("missing optimizer metadata");
  const pairs: [string, unknown, unknown][] = [
    ["browser/device", previous.environment, current.environment],
    ["model", left?.manifestId, right?.manifestId],
    ["target", left?.targetPath, right?.targetPath],
    ["precision", left?.capabilities.precision, right?.capabilities.precision],
    ["GPU adapter", left?.capabilities.adapter, right?.capabilities.adapter],
    ["workload", previous.browser?.settings, current.browser?.settings],
    ["optimizer", left?.optimizer, right?.optimizer],
  ];
  for (const [name, a, b] of pairs) {
    if (!isDeepStrictEqual(a, b)) reasons.push(`different ${name}`);
  }
  if (reasons.length)
    return ["Comparison not ranked: " + reasons.join("; ") + "."];
  const lines = [
    "Observed paired ratios (previous median / current median; not a significance test):",
  ];
  for (const mode of ["compute", "frame"] as const) {
    const a = previous.browser?.modes[mode];
    const b = current.browser?.modes[mode];
    if (!a?.samples.length || !b?.samples.length)
      return ["Comparison not ranked: missing measured samples."];
    const metric = mode === "frame" ? "round_trip_ms" : "worker_ms";
    const before = statistics(a.samples.map((sample) => sample[metric])).median;
    const after = statistics(b.samples.map((sample) => sample[metric])).median;
    lines.push(
      `- ${mode}: ${(before / after).toFixed(3)}× (${before.toFixed(1)} → ${after.toFixed(1)} ms).`,
    );
  }
  return lines;
}

function modeSummary(name: string, result: ModeResult): string[] {
  const worker = statistics(result.samples.map((sample) => sample.worker_ms));
  const delivered = statistics(
    result.samples.map((sample) => sample.round_trip_ms),
  );
  const memories = [...result.warmup, ...result.samples]
    .flatMap((sample) => [sample.before, sample.after])
    .filter((memory) => memory !== null);
  const lines = [
    `### ${name}`,
    "",
    `First update: ${result.first.worker_ms.toFixed(1)} ms. Warm measured samples: ${worker.count}.`,
    `Worker completion: median ${worker.median.toFixed(1)} ms; p90 ${worker.p90.toFixed(1)} ms.`,
    `Page-to-worker round trip: median ${delivered.median.toFixed(1)} ms; p90 ${delivered.p90.toFixed(1)} ms.`,
    `Final unshifted weighted loss: ${result.final.loss.toPrecision(7)} after ${result.final.step} updates.`,
  ];
  if (memories.length) {
    const mib = 1024 * 1024;
    lines.push(
      `Largest observed pool counters at step boundaries: ${(Math.max(...memories.map((memory) => memory.used_bytes)) / mib).toFixed(1)} MiB live; ${(Math.max(...memories.map((memory) => memory.reserved_bytes)) / mib).toFixed(1)} MiB reserved.`,
    );
  }
  const submissions = result.samples.flatMap((sample) =>
    sample.submission_ms === undefined ? [] : [sample.submission_ms],
  );
  if (submissions.length) {
    lines.push(
      `Host graph and submission: median ${statistics(submissions).median.toFixed(1)} ms. This overlaps GPU execution; it is not an extra additive cost.`,
    );
  }
  if (name === "profile") {
    for (const stage of result.samples[0]?.stages ?? []) {
      const values = result.samples
        .flatMap((sample) => sample.stages ?? [])
        .filter(
          (row) =>
            row.stage === stage.stage &&
            row.method === "device" &&
            row.milliseconds !== null,
        )
        .map((row) => row.milliseconds!);
      lines.push(
        values.length
          ? `- ${stage.stage}: GPU median ${statistics(values).median.toFixed(3)} ms (${values.length} samples).`
          : `- ${stage.stage}: no device measurement.`,
      );
    }
  }
  return [...lines, ""];
}

export function summarize(report: Report, comparison: string[] = []): string {
  const result = report.browser;
  const load = result?.performanceLoad;
  const checks =
    result?.qualification?.checks ??
    report.events
      .filter((event) => event.type === "check")
      .map((event) => event.check);
  const qualification = result?.qualification
    ? `${checks.filter((check) => check.passed).length}/${checks.length} checks passed`
    : `incomplete; recorded checks: ${checks.length}`;
  const lines = [
    `# ${report.label}`,
    "",
    report.createdAt,
    "",
    `Build: ${report.build.revision}${report.build.dirty ? " (dirty)" : ""}; release WASM.`,
    `Chrome ${report.environment.browserVersion}; ${report.environment.headless ? "headless" : "visible"}; ${report.environment.platform}/${report.environment.arch}.`,
    `Qualification: ${qualification}.`,
    "",
  ];
  if (report.environment.cpuProfiling)
    lines.push("CPU sampling enabled. Do not rank these timings. See cpu-trace.json.", "");
  if (load) {
    lines.push(
      `Model: ${load.manifestId}; ${load.targetPath}.`,
      `Precision: ${JSON.stringify(load.capabilities.precision)}.`,
      `Performance-worker load: ${load.startup.total_ms.toFixed(1)} ms; ${load.cacheHits} cache hits; ${load.networkRequests} asset requests.`,
      "",
    );
  }
  for (const [mode, data] of Object.entries(result?.modes ?? {}))
    lines.push(...modeSummary(mode, data));
  if (result?.profileUnavailable) lines.push(result.profileUnavailable, "");
  if (result?.frameBreakdown?.length) {
    const keys = ["submission_ms", "gpu_wait_ms", "readback_ms", "conversion_ms", "total_ms"] as const;
    lines.push("## Frame update, time split (medians)", "", "| Readback | Submission | GPU wait | Readback | Conversion | Total |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const waitFirst of [false, true]) {
      const rows = result.frameBreakdown.filter((row) => row.waitFirst === waitFirst);
      if (rows.length === 0) continue;
      const timings = keys.map((key) => `${statistics(rows.map((row) => row[key])).median.toFixed(1)} ms`);
      lines.push(`| ${waitFirst ? "after the GPU queue is done" : "at once, as in step()"} | ${timings.join(" | ")} |`);
    }
    lines.push("");
  }
  if (result?.products) {
    lines.push(
      "## Matrix products of one block, per call",
      "",
      "| Product | Forward | TFLOP/s | Forward and input gradients | TFLOP/s |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...result.products.map(
        (product) =>
          `| ${product.name} | ${product.forward_ms.toFixed(3)} ms | ${product.forward_tflops.toFixed(2)} | ${product.forward_backward_ms.toFixed(3)} ms | ${product.forward_backward_tflops.toFixed(2)} |`,
      ),
      "",
    );
  }
  const errors = [...report.errors, ...(result?.error ? [result.error] : [])];
  if (errors.length)
    lines.push("## Run errors", "", ...errors.map((error) => `- ${error}`), "");
  lines.push(
    ...comparison,
    "",
    "## Measurement scope",
    "",
    "Compute samples wait for the engine's GPU queue. They do not read preview pixels.",
    "Frame samples include loss and image readback. Round-trip time also includes worker messaging and pixel transfer; it excludes canvas painting.",
    "Profile samples use separate timing windows. Do not use their wall time to rank an optimization.",
    "Modes run in order (compute, frame, profile). On the M1 Max the update slows after about 40 updates of sustained work and under other GPU load, so a later mode can look slower; the frame split alternates its two orders and measures the readback directly.",
    "Pool counters are observations before and after updates, not the exact peak or total browser memory.",
    "Assets are served from localhost. Loading results are not Internet download measurements.",
    "All raw samples, checks, device limits, and progress events are in report.json.",
    "",
  );
  return lines.join("\n");
}
