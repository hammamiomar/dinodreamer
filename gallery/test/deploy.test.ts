import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { publishedEngineExists, checkQualifiedEngine, parseDeployOptions, withReleaseCheckout, previewUrl, workersSubdomain } from "../deploy.ts";

describe("release engine qualification", () => {
  const qualified = createHash("sha256").update("qualified runtime").digest("hex");
  it("requires the full qualified hash before deployment", () => {
    expect(() => checkQualifiedEngine(qualified, qualified)).not.toThrow();
    expect(() => checkQualifiedEngine("0".repeat(64), qualified)).toThrow("differs from the qualified");
    expect(() => checkQualifiedEngine(qualified, qualified.slice(0, 16))).toThrow("full lowercase SHA-256");
  });
  it("checks publication with one public HEAD request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": "application/wasm" } }));
    await expect(publishedEngineExists("https://library.example/app/runtime.wasm", fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://library.example/app/runtime.wasm", {
      method: "HEAD", signal: expect.any(AbortSignal),
    });
  });
  it("reports a missing object separately from network or server failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(publishedEngineExists("https://library.example/app/runtime.wasm", fetcher)).resolves.toBe(false);
  });
  it.each([
    [200, "text/html"],
    [503, "application/wasm"],
  ])("refuses HTTP %s with type %s", async (status, type) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status, headers: { "content-type": type } }));
    await expect(publishedEngineExists("https://library.example/app/runtime.wasm", fetcher)).rejects.toThrow("not published");
  });
});

it("reads the alias from Wrangler's structured upload output", () => {
  const output = [
    { type: "asset-upload", version: 1 },
    { type: "version-upload", preview_url: "https://version.worker.workers.dev", preview_alias_url: "https://pr-1-worker.workers.dev" },
  ].map(record => JSON.stringify(record)).join("\n");
  expect(previewUrl(output)).toBe("https://pr-1-worker.workers.dev");
  expect(() => previewUrl('{"type":"version-upload"}')).toThrow("preview alias URL");
});

it("finds the account's workers.dev subdomain in a preview address, so that GitHub can mask it", () => {
  expect(workersSubdomain("https://pr-7-dinodreamer-public.example-account.workers.dev")).toBe("example-account");
  expect(workersSubdomain("https://0123abcd-dinodreamer-public.example-account.workers.dev/train")).toBe("example-account");
  expect(() => workersSubdomain("https://dinodreamer.computervision.vision")).toThrow("Not a workers.dev address");
});

describe("deployment destination", () => {
  it("requires an unambiguous revision and preview alias", () => {
    expect(parseDeployOptions(["main", "--ci", "--preview-alias=pr-7"])).toEqual({ revision: "main", alias: "pr-7", ci: true, withoutGpu: false });
    for (const options of [["--preview-alia=pr-7"], ["--preview-alias", "pr-7"], ["--preview-alias=pr-0"], ["--preview-alias"], ["main", "other"], ["--", "--preview-alias"]]) {
      expect(() => parseDeployOptions(options)).toThrow();
    }
  });

  it("resolves each source branch before checkout and removes only its own worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "deploy-sources-"));
    const parent = join(root, "checkouts");
    const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    try {
      const repositories = ["first", "second"].map((name) => {
        git(root, "init", "-q", "-b", "main", name);
        const directory = join(root, name);
        git(directory, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", name, "--allow-empty");
        return directory;
      });
      await withReleaseCheckout(repositories[0]!, "main", parent, async (first, commit) => {
        expect(commit).toBe(git(repositories[0]!, "rev-parse", "main"));
        let secondPath = "";
        await expect(withReleaseCheckout(repositories[1]!, "main", parent, async (second, revision) => {
          secondPath = second;
          expect(second).not.toBe(first);
          expect(revision).toBe(git(repositories[1]!, "rev-parse", "main"));
          expect(git(second, "rev-parse", "HEAD")).toBe(revision);
          throw new Error("build failed");
        })).rejects.toThrow("build failed");
        expect(existsSync(secondPath)).toBe(false);
        expect(git(first, "rev-parse", "HEAD")).toBe(commit);
      });
      for (const directory of repositories) expect(git(directory, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
