// Target geometry shared by recipe validation, editing and the worker. No I/O.
import type { CloudPoint } from "./library/records";
import { GRID, type Code, type CodeTarget, type Request } from "./recipe.ts";

export const MAX_REGION_POINTS = 4096;

export function scaleCode(code: Code, radius: number): Code {
  return [code[0] * radius, code[1] * radius, code[2] * radius];
}

export function squaredDistance(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, axis) => sum + (value - b[axis]!) ** 2, 0);
}

/** Project cell centres on the anchor segment, then clamp to its endpoints. */
export function pathCode(target: Extract<CodeTarget, { kind: "path" }>, cell: number): Code {
  const [a, b] = target.anchors;
  const dx = b % GRID - a % GRID;
  const dy = Math.floor(b / GRID) - Math.floor(a / GRID);
  const projection = ((cell % GRID - a % GRID) * dx + (Math.floor(cell / GRID) - Math.floor(a / GRID)) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, projection));
  return target.codes[0].map((value, axis) => (1 - t) * value + t * target.codes[1][axis]!) as Code;
}

export function targetProblems(request: Request): string[] {
  const { target, radius, alsoBlocks, source, where } = request.respondLike;
  const problems: string[] = [];
  if (!Number.isFinite(radius) || radius < 0.5 || radius > 8) problems.push("Target radius must be between 0.5 and 8");
  if (target.kind === "point") return problems;
  if (source.role !== "patch" || alsoBlocks.length !== 0) problems.push("paths and response selections need a patch constraint with one basis group");
  if (target.kind === "region") {
    if (!Number.isFinite(target.selectionRadius) || target.selectionRadius <= 0) problems.push("response selection radius must be positive");
    if (!Number.isFinite(target.lambda) || target.lambda < 0) problems.push("response selection coverage weight must be non-negative");
  } else if (target.anchors[0] === target.anchors[1]) {
    problems.push("path endpoints must be different cells");
  } else if (where.some((strength, cell) => strength > 0 && Math.hypot(...scaleCode(pathCode(target, cell), radius)) < 1e-6)) {
    problems.push("a path target has length below 0.000001 at a painted cell");
  }
  return problems;
}

export function sameCodeTarget(a: CodeTarget, b: CodeTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "point") return true;
  if (a.kind === "path" && b.kind === "path") {
    return a.anchors.every((cell, index) => cell === b.anchors[index]) &&
      a.codes.every((code, index) => code.every((value, axis) => value === b.codes[index]![axis]));
  }
  return a.kind === "region" && b.kind === "region" && a.selectionRadius === b.selectionRadius && a.lambda === b.lambda &&
    a.centre.every((value, axis) => value === b.centre[axis]);
}

/** Select first, then scale. Equal target weights sum to one. */
export function regionCodes(target: Extract<CodeTarget, { kind: "region" }>, cloud: readonly Code[], radius: number): Code[] {
  const selected = cloud.filter((code) => squaredDistance(code, target.centre) <= target.selectionRadius ** 2);
  if (selected.length === 0) throw new Error("The response selection contains no recorded patch response vectors. Enlarge or move it.");
  if (selected.length > MAX_REGION_POINTS) throw new Error(`A response selection can contain at most ${MAX_REGION_POINTS} response vectors.`);
  const scaled = selected.map((code) => scaleCode(code, radius));
  const normSquared = scaled.reduce((sum, code) => sum + code.reduce((norm, value) => norm + value * value, 0), 0) / scaled.length;
  if (normSquared < 1e-12) throw new Error("The response selection's RMS response vector length is below 0.000001.");
  return scaled;
}

/** Unique patch tokens from the published cloud. */
export function regionSource(cloud: readonly CloudPoint[]): CloudPoint[] {
  const seen = new Set<string>();
  return cloud.filter(({ token }) => {
    const key = `${token.imageId}:${token.slot}`;
    if (token.role !== "patch" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
