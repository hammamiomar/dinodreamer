import { chromium } from "playwright-core";
import type { Browser, CDPSession } from "playwright-core";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchmarkEvent, BrowserResult } from "./protocol.ts";
import { parseOptions, withTimeout } from "./options.ts";
import { compareReports, summarize } from "./report.ts";
import type { Report } from "./report.ts";
import { serveHarness } from "./server.ts";
import { startCpuProfile, saveCpuProfile } from "./cpu-profile.ts";

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const root = fileURLToPath(new URL("../", import.meta.url));
  await access(resolve(root, "local/release/releases/pass-003.json"));
  await access(resolve(root, "local/reference.safetensors"));
  const previous: Report | undefined = options.compare
    ? JSON.parse(await readFile(resolve(options.compare), "utf8"))
    : undefined;
  // Incremental release build. Never copy or regenerate the model/fixtures here.
  execFileSync("pnpm", ["build:harness"], { cwd: root, stdio: "inherit" });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const createdAt = new Date().toISOString();
  const output = resolve(
    root,
    "local/bench",
    `${createdAt.replace(/[:.]/g, "-")}-${options.label}`,
  );
  await mkdir(output, { recursive: true });
  const changes = git("status", "--short");
  const report: Report = {
    schema: 1,
    label: options.label,
    createdAt,
    build: {
      revision: git("rev-parse", "HEAD"),
      dirty: changes.length > 0,
      changes,
      mode: "release",
    },
    environment: {
      browserVersion: "not launched",
      headless: !options.headed,
      platform: platform(),
      arch: arch(),
      gpuDevices: [],
      gpuFeatures: {},
      ...(options.cpuProfile ? { cpuProfiling: true } : {}),
    },
    events: [],
    requests: [],
    errors: [],
    browserConsole: [],
  };
  let phase = "startup";
  const server = await serveHarness(root, () => phase);
  let browser: Browser | undefined;
  let profiling: CDPSession | undefined;
  const interrupt = () => {
    report.errors.push("Interrupted");
    void browser?.close();
  };
  process.once("SIGINT", interrupt);
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: !options.headed,
      chromiumSandbox: true,
    });
    report.environment.browserVersion = browser.version();
    const cdp = await browser.newBrowserCDPSession();
    if (options.cpuProfile) {
      await startCpuProfile(cdp);
      profiling = cdp;
    }
    const info = await cdp.send("SystemInfo.getInfo");
    report.environment.gpuDevices = info.gpu.devices;
    report.environment.gpuFeatures = info.gpu.featureStatus ?? {};
    const page = await browser.newPage();
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        report.browserConsole!.push({
          type: message.type(),
          message: message.text(),
        });
      }
    });
    await page.exposeFunction("reportBenchmarkEvent", (event: BenchmarkEvent) => {
      report.events.push(event);
      if (event.type === "phase") {
        if (!event.message.startsWith("Loaded ")) phase = event.message;
        console.log(event.message);
      } else if (event.type === "check") {
        console.log(
          `${event.check.passed ? "PASS" : "FAIL"} ${event.check.name}: relative RMS ${event.check.relative_rms.toExponential(3)}`,
        );
      } else if (event.sample.step % 5 === 0) {
        console.log(
          `${event.mode} step ${event.sample.step}: ${event.sample.worker_ms.toFixed(0)} ms${event.warmup ? " (warmup)" : ""}`,
        );
      }
    });
    await page.goto(server.url);
    await page.waitForFunction(() => typeof window.runHarness === "function");
    report.browser = (await withTimeout(
      page.evaluate(async (settings) => {
        const notify = (event: BenchmarkEvent) => {
          document.querySelector("#status")!.textContent = JSON.stringify(
            event,
            null,
            2,
          );
          void (
            window as unknown as {
              reportBenchmarkEvent: (event: BenchmarkEvent) => Promise<void>;
            }
          ).reportBenchmarkEvent(event);
        };
        return window.runHarness(settings, notify);
      }, options.settings),
      options.timeoutMinutes * 60_000,
    )) as BrowserResult;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (profiling) {
      try {
        await saveCpuProfile(profiling, resolve(output, "cpu-trace.json"));
      } catch (error) {
        report.errors.push(`CPU trace: ${String(error)}`);
      }
    }
    await browser?.close();
    await server.close();
    process.removeListener("SIGINT", interrupt);
    report.requests = server.requests;
    const unexpected = report.requests.filter((request) =>
      request.phase.includes("updates (no asset requests)"),
    );
    if (unexpected.length)
      report.errors.push(
        `${unexpected.length} unexpected HTTP requests during numerical updates.`,
      );
    await writeFile(
      resolve(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(`Saved raw results: ${output}/report.json`);
    const summary = summarize(
      report,
      previous ? compareReports(previous, report) : [],
    );
    await writeFile(resolve(output, "summary.md"), summary);
    console.log(summary);
    console.log(`Saved ${output}`);
  }
  if (report.errors.length || report.browser?.error) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
