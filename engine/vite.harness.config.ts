import { defineConfig } from "vite";

export default defineConfig({
  root: "benchmarks",
  publicDir: false,
  build: { outDir: "../dist-harness", emptyOutDir: true },
  worker: { format: "es" },
});
