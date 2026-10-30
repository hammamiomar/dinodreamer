import type { CDPSession } from "playwright-core";
import { writeFile } from "node:fs/promises";

/** Trace all renderer threads, including dedicated WASM workers. Diagnostic only. */
export async function startCpuProfile(cdp: CDPSession): Promise<void> {
  await cdp.send("Tracing.start", {
    categories: "disabled-by-default-v8.cpu_profiler,blink.user_timing",
    options: "sampling-frequency=1000",
    transferMode: "ReturnAsStream",
  });
}

export async function saveCpuProfile(
  cdp: CDPSession,
  path: string,
): Promise<void> {
  const completed = new Promise<string>((resolve, reject) => {
    cdp.once("Tracing.tracingComplete", ({ stream }) => {
      if (stream) resolve(stream);
      else reject(new Error("CPU trace did not return a stream."));
    });
  });
  await cdp.send("Tracing.end");
  const handle = await completed;
  const chunks: string[] = [];
  let eof = false;
  while (!eof) {
    const part = await cdp.send("IO.read", { handle });
    chunks.push(
      part.base64Encoded
        ? Buffer.from(part.data, "base64").toString("utf8")
        : part.data,
    );
    eof = part.eof;
  }
  await cdp.send("IO.close", { handle });
  await writeFile(path, chunks.join(""));
}
