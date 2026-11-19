import { defineConfig } from "vitest/config";
import unitTestPatterns from "../ci/unit-test-patterns.ts";

export default defineConfig({
  test: { include: unitTestPatterns.gallery, setupFiles: ["test/siteverify.ts"] },
});
