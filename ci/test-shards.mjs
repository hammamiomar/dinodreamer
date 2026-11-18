import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const unitProjects = ["app", "gallery"];

// A new file receives the suite's median until main records its duration.
function durationLookup(weights) {
  const known = Object.values(weights).sort((a, b) => a - b);
  const typical = known[Math.floor(known.length / 2)] ?? 1;
  return (file) => weights[file] ?? typical;
}

// Longest first gives the next file to the shard with the least recorded work.
export function balance(files, weights, maximum, minimumSize) {
  if (!files.length) return [];
  const weight = durationLookup(weights);
  const ordered = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const count = Math.min(maximum, Math.ceil(files.length / minimumSize));
  const shards = Array.from({ length: count }, () => ({
    files: [],
    duration: 0,
  }));
  for (const file of ordered) {
    const lightest = shards.reduce((a, b) => (a.duration <= b.duration ? a : b));
    lightest.files.push(file);
    lightest.duration += weight(file);
  }
  return shards;
}

// One Vitest process serves one project. Give each project its own jobs when enough
// tests changed to justify multiple runners. Share one job for a small mixed change.
export function unitShards(files, weights) {
  const count = Math.min(4, Math.ceil(files.length / 24));
  if (count <= 1) return balance(files, weights, 1, 24);
  const weight = durationLookup(weights);
  const groups = unitProjects
    .map((project) => {
      const projectFiles = files.filter((file) => file.startsWith(project + "/"));
      const total = projectFiles.reduce((sum, file) => sum + weight(file), 0);
      return { files: projectFiles, total, slots: 1 };
    })
    .filter((group) => group.files.length > 0);
  for (let available = count - groups.length; available > 0; available--) {
    const candidates = groups.filter((group) => group.slots < group.files.length);
    const largest = candidates.reduce((a, b) => (a.total / a.slots >= b.total / b.slots ? a : b));
    largest.slots++;
  }
  return groups.flatMap((group) => balance(group.files, weights, group.slots, 1));
}

export function recordedDurations(directory) {
  const weights = JSON.parse(readFileSync(resolve(import.meta.dirname, "test-durations.json"), "utf8"));
  if (directory && existsSync(directory)) {
    for (const name of readdirSync(directory)) {
      const suite = name.split("-")[0];
      if (!["unit", "browser"].includes(suite) || !name.endsWith(".json")) continue;
      const recorded = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
      for (const [file, milliseconds] of Object.entries(recorded)) {
        if (Number.isFinite(milliseconds) && milliseconds > 0) weights[suite][file] = milliseconds;
      }
    }
  }
  return weights;
}
