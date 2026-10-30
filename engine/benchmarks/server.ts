import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export interface ServedRequest {
  path: string;
  bytes: number;
  phase: string;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".css": "text/css",
};

/** Serve existing large files in place. The build does not copy the model. */
export async function serveHarness(root: string, phase: () => string) {
  const requests: ServedRequest[] = [];
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      let directory = resolve(root, "dist-harness");
      let relative =
        path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
      if (path.startsWith("/release/")) {
        directory = resolve(root, "local/release");
        relative = decodeURIComponent(path.slice("/release/".length));
      } else if (path === "/fixture/reference.safetensors") {
        directory = resolve(root, "local");
        relative = "reference.safetensors";
      } else if (path.startsWith("/fixture/evidence-")) {
        directory = resolve(root, "tools/fixtures");
        relative = decodeURIComponent(path.slice("/fixture/".length));
      }
      const file = resolve(directory, relative);
      if (!file.startsWith(directory + sep)) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      requests.push({ path, bytes: info.size, phase: phase() });
      response.writeHead(200, {
        "Content-Type":
          contentTypes[extname(file)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-cache",
      });
      const stream = createReadStream(file);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local server address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
