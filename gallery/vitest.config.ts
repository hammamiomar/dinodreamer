import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The Worker imports its owner page as text, as wrangler bundles an .html import (src/text-modules.d.ts).
export default defineConfig({
  test: { setupFiles: ["test/siteverify.ts"] },
  plugins: [
    {
      name: "html-as-text",
      enforce: "pre",
      load(id: string) {
        return id.endsWith(".html") ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};` : null;
      },
    },
  ],
});
