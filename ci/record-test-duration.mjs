import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

// Add this reporter to a complete Vitest run to refresh the weights used by the planner.
export default class TestDurationReporter {
  onTestRunEnd(modules) {
    const weights = {};
    for (const module of modules) {
      const { prepareDuration, environmentSetupDuration, setupDuration, collectDuration, duration } =
        module.diagnostic();
      weights[relative(resolve(import.meta.dirname, ".."), module.moduleId)] = Math.max(
        1,
        Math.round(prepareDuration + environmentSetupDuration + setupDuration + collectDuration + duration),
      );
    }
    writeFileSync(process.env.TEST_DURATION_FILE, JSON.stringify(weights, null, 2) + "\n");
  }
}
