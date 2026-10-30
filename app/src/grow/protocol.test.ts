import { describe, expect, test } from "vitest";
import { adapterUnavailable } from "./protocol";

describe("an engine start error", () => {
  test("is the browser having no GPU adapter when wgpu says so", () => {
    // The message an iPhone 16 Pro Max showed on the first load after a run took the page down.
    expect(adapterUnavailable("No adapter available for WgpuDevice { kind: DefaultDevice, backend: Auto }: No suitable graphics adapter found; noop not requested, vulkan not requested, metal not requested, dx12 not requested, gl not requested, webgpu found no adapters")).toBe(true);
    expect(adapterUnavailable("The GPU device was lost (Unknown): out of memory")).toBe(false);
    expect(adapterUnavailable("Failed to fetch")).toBe(false);
  });
});
