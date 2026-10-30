import { describe, expect, it } from "vitest";
import type { TokenAddress } from "../../../library/addresses";
import { patchSlot, type Token } from "../../../recipe";
import { createRecipe, createRequest, setCodeBlockCount } from "../model";
import { pointKey, pointToken } from "./block-cloud";
import { randomPoint, retargetAction } from "./retarget";

const source: Token = { imageId: 7, role: "patch", slot: patchSlot(2, 8) };
const request = () => createRequest(createRecipe("pass-003"), { token: source, block: 1398, code: [0.4, -0.2, 0.9] }).requests[0]!;
const point = (imageId: number, slot: number) => ({ key: pointKey({ imageId, slot }), code: [1, 2, 3] as [number, number, number] });
function addressOf(token: Token): TokenAddress {
  return { token, blocks: Array.from({ length: 32 }, (_, rank) => ({ block: 100 + rank, code: [rank + 1, 0, 0] as [number, number, number] })) };
}

describe("cloud point keys", () => {
  it("name the recorded token, and read back from the key", () => {
    expect(pointKey({ imageId: 4379816591485095, slot: 150 })).toBe("4379816591485095:150");
    expect(pointToken("4379816591485095:150")).toEqual({ imageId: 4379816591485095, slot: 150 });
    expect(pointToken("not a point")).toBeNull();
  });
});

describe("retargetAction", () => {
  it("makes a point of the block the target, with its recorded code, without reading an address at one block", async () => {
    const reads: Token[] = [];
    const library = { tokenAddress: (token: Token) => (reads.push(token), Promise.resolve(addressOf(token))) };
    const action = await retargetAction(library, request(), point(9, patchSlot(5, 5)), 0);
    expect(action).toEqual({
      type: "retargetRequest",
      requestId: 1,
      opened: 0,
      expectedSource: source,
      expectedTarget: { kind: "point" },
      token: { imageId: 9, role: "patch", slot: patchSlot(5, 5) },
      code: [1, 2, 3],
      address: null,
    });
    expect(reads).toEqual([]);
  });

  it("reads the new token's address when the request asks more than one block", async () => {
    const recipe = setCodeBlockCount(createRequest(createRecipe("pass-003"), { token: source, block: 1398, code: [0.4, -0.2, 0.9] }), 1, 3, addressOf(source));
    const target = { imageId: 9, role: "patch" as const, slot: patchSlot(5, 5) };
    const action = await retargetAction({ tokenAddress: (token: Token) => Promise.resolve(addressOf(token)) }, recipe.requests[0]!, point(9, target.slot), 0);
    expect(action && action.type === "retargetRequest" && action.address).toEqual(addressOf(target));
    await expect(retargetAction({ tokenAddress: () => null }, recipe.requests[0]!, point(9, target.slot), 0)).rejects.toThrow("does not publish");
    await expect(retargetAction({ tokenAddress: () => Promise.reject(new Error("503")) }, recipe.requests[0]!, point(9, target.slot), 0)).rejects.toThrow("503");
  });

  it("does nothing for the request's own token or a key that is not a point", async () => {
    const library = { tokenAddress: () => Promise.resolve(addressOf(source)) };
    expect(await retargetAction(library, request(), point(source.imageId, source.slot), 0)).toBeNull();
    expect(await retargetAction(library, request(), { key: "x", code: [1, 2, 3] }, 0)).toBeNull();
  });
});

describe("randomPoint", () => {
  it("picks any point but the request's own token, each as likely", () => {
    const cloud = [point(source.imageId, source.slot), point(9, 20), point(10, 30), point(11, 40)];
    const picks = [0, 0.34, 0.67, 0.999].map((value) => randomPoint(cloud, request(), () => value)?.key);
    expect(picks).toEqual(["9:20", "10:30", "11:40", "11:40"]);
    expect(randomPoint([point(source.imageId, source.slot)], request())).toBeNull();
  });
});

it("drops a loaded retarget after its creation or source is replaced, but keeps unrelated edits", async () => {
  const { createEditorState, editorReducer } = await import("../state");
  const { setTermWeight, removeRequest } = await import("../model");
  const original = request();
  const initial = { ...createEditorState("pass-003"), recipe: { ...createRecipe("pass-003"), requests: [original] } };
  const action = await retargetAction({ tokenAddress: () => null }, original, point(9, 5), initial.opened);
  expect(action).not.toBeNull();
  if (!action) return;
  const opened = { ...initial, opened: initial.opened + 1 };
  expect(editorReducer(opened, action)).toBe(opened);
  const replaced = {
    ...initial,
    recipe: createRequest(removeRequest(initial.recipe, 1), { token: source, block: 1398, code: [0.4, -0.2, 0.9] }),
  };
  expect(editorReducer(replaced, action)).toBe(replaced);
  const edited = { ...initial, recipe: setTermWeight(initial.recipe, "request:1:look", 2) };
  const moved = editorReducer(edited, action);
  expect(moved.recipe.requests[0].respondLike.source.imageId).toBe(9);
  expect(moved.recipe.requests[0].lookLike.weight).toBe(2);
});
