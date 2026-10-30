import { afterEach, describe, expect, it, vi } from "vitest";
import { createFigureReplay, type FigureReplay } from "./figure-replay";
import { FIGURE_SHADERS } from "./figure-shaders";
import type { ReplayLoop, ReplayLoopOptions } from "./replay-loop";
import { startReplayLoop } from "./replay-loop";
import { openStageSession } from "./stage-session";

/** A replay double that throws once disposed, as the WebGPU runtime does. */
function replayStub(name: string, log: string[]) {
  let disposed = false;
  const guard = () => { if (disposed) throw new Error("The replay is closed."); };
  return {
    side: 128, seed: 1, damages: 0, tick: 0,
    reseed() { guard(); },
    async advance() { log.push(`${name} advance`); await Promise.resolve(); guard(); },
    async present() { guard(); },
    async stamp() { guard(); },
    async damage() { guard(); },
    dispose() { log.push(`${name} dispose`); disposed = true; },
    get disposed() { return disposed; },
  } as unknown as FigureReplay & { disposed: boolean };
}

/** Replays that arrive when the test says, as an asynchronous WebGPU start does. */
function deferredCreates() {
  const pending: { resolve: (replay: FigureReplay) => void }[] = [];
  const create = () => new Promise<FigureReplay>((resolve) => { pending.push({ resolve }); });
  return { create, pending };
}

type HoldPoint = "device" | "compute pipelines" | "presentation pipeline";

/**
 * Just enough WebGPU for createFigureReplay to start, draw and close on one shared canvas. Each start
 * gets its own device; the canvas context records its configuration and, as Chrome does, refuses
 * getCurrentTexture when nothing configures it. The next start can be held at one of its awaits.
 */
function webGpuStub(failure?: "compute" | "presentation" | "context" | "allocation") {
  type Device = GPUDevice & { destroyed: boolean; buffers: { destroyed: boolean }[] };
  let configuration: GPUCanvasConfiguration | undefined;
  const context = {
    configure(next: GPUCanvasConfiguration) { configuration = next; },
    unconfigure() { configuration = undefined; },
    getConfiguration() { return configuration ?? null; },
    getCurrentTexture() {
      if (!configuration) throw new Error("getCurrentTexture: context is not configured");
      if ((configuration.device as Device).destroyed) throw new Error("getCurrentTexture: the device is destroyed");
      return { createView: () => ({}) };
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => failure === "context" ? null : context } as unknown as HTMLCanvasElement;
  const held: (() => void)[] = [];
  let holdNext: HoldPoint | undefined;
  const later = <T>(value: T, hold: boolean) => hold ? new Promise<T>((resolve) => { held.push(() => resolve(value)); }) : Promise.resolve(value);
  /** One device per start, in the order the starts began. */
  const devices: Device[] = [];
  const createDevice = (hold: HoldPoint | undefined) => {
    let lose = (_info: GPUDeviceLostInfo) => {};
    const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, draw() {}, end() {} };
    const pipeline = (label?: string) => ({ label, getBindGroupLayout: () => ({}) });
    const buffers: { destroyed: boolean }[] = [];
    const device = {
      destroyed: false,
      buffers,
      lost: new Promise<GPUDeviceLostInfo>((resolve) => { lose = resolve; }),
      queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {} },
      createBuffer: ({ size }: GPUBufferDescriptor) => {
        if (failure === "allocation" && buffers.length === 2) throw new Error("allocation failed");
        const buffer = {
          size, destroyed: false,
          destroy() { buffer.destroyed = true; },
          mapAsync: async () => {},
          getMappedRange: () => new ArrayBuffer(size),
        };
        buffers.push(buffer);
        return buffer;
      },
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createShaderModule: () => ({}),
      createBindGroup: () => ({}),
      createComputePipelineAsync: (descriptor: GPUComputePipelineDescriptor) => failure === "compute" ? Promise.reject(new Error("compute failed")) : later(pipeline(descriptor.label), hold === "compute pipelines"),
      createRenderPipelineAsync: (descriptor: GPURenderPipelineDescriptor) => failure === "presentation" ? Promise.reject(new Error("presentation failed")) : later(pipeline(descriptor.label), hold === "presentation pipeline"),
      createCommandEncoder: () => ({
        beginComputePass: () => pass,
        beginRenderPass: () => pass,
        copyBufferToBuffer() {},
        finish: () => ({}),
      }),
      destroy() {
        device.destroyed = true;
        lose({ reason: "destroyed", message: "" } as GPUDeviceLostInfo);
      },
    } as unknown as Device;
    devices.push(device);
    return device;
  };
  const gpu = {
    getPreferredCanvasFormat: () => "bgra8unorm",
    requestAdapter: async () => {
      const hold = holdNext;
      holdNext = undefined;
      const device = createDevice(hold);
      return { requestDevice: () => later(device, hold === "device") };
    },
  };
  vi.stubGlobal("navigator", { gpu });
  vi.stubGlobal("GPUBufferUsage", { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 });
  vi.stubGlobal("GPUShaderStage", { COMPUTE: 4 });
  vi.stubGlobal("GPUMapMode", { READ: 1 });
  return {
    canvas,
    devices,
    /** Buffers created and not yet destroyed, over every device. */
    liveBuffers: () => devices.flatMap((device) => device.buffers).filter((buffer) => !buffer.destroyed).length,
    createDevice: () => createDevice(undefined),
    holdNextStart(point: HoldPoint) { holdNext = point; },
    releaseHeld() { held.splice(0).forEach((resolve) => resolve()); },
    get configuredDevice() { return configuration?.device; },
  };
}

const RULE = { values: new Float32Array(7776), fireRate: 0.5 };
const PYRAMID_RULE = { values: new Float32Array(17088), fireRate: 0.5 };

describe("stage session", () => {
  it("applies playback changes made while the replay is opening", async () => {
    const { create, pending } = deferredCreates();
    const replay = replayStub("pending", []);
    const reseed = vi.spyOn(replay, "reseed");
    const start = vi.fn(() => ({ stop: vi.fn() }) as unknown as ReplayLoop);
    const session = openStageSession(create, { speed: 1, playing: true }, start);
    session.setPlaying(false);
    session.setSpeed(0.5);
    session.reseed(7);
    pending[0].resolve(replay);
    await Promise.resolve();
    expect(reseed).toHaveBeenCalledWith(7);
    expect(start).toHaveBeenCalledWith(replay, expect.objectContaining({ playing: false, speed: 0.5 }));
    session.close();
  });

  it("releases the replay and reports a loop initialization failure", async () => {
    const replay = replayStub("failed", []);
    const onError = vi.fn();
    openStageSession(async () => replay, { speed: 1, playing: true, onError }, () => { throw new Error("loop failed"); });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "loop failed" })));
    expect(replay.disposed).toBe(true);
  });

  it("disposes a replay that arrives after its session closed, and never starts its loop", async () => {
    const log: string[] = [];
    const { create, pending } = deferredCreates();
    const start = vi.fn();
    const onError = vi.fn();
    const session = openStageSession(create, { speed: 1, playing: true, onError }, start);
    session.close();
    const replay = replayStub("a", log);
    pending[0].resolve(replay);
    await Promise.resolve();
    expect(replay.disposed).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("switches materials repeatedly, quickly and mid-start, with one live replay and no error", async () => {
    const log: string[] = [];
    const { create, pending } = deferredCreates();
    const onError = vi.fn();
    const frames: (() => void)[] = [];
    const schedule = (callback: () => void) => { frames.push(callback); };
    const start = (replay: FigureReplay, options: ReplayLoopOptions): ReplayLoop => startReplayLoop(replay, { ...options, schedule });
    const settle = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
    const replays: (FigureReplay & { disposed: boolean })[] = [];
    const resolved = new Set<number>();
    const arrive = (index: number, name: string) => {
      const replay = replayStub(name, log);
      replays.push(replay);
      resolved.add(index);
      pending[index].resolve(replay);
      return replay;
    };
    let session = openStageSession(create, { speed: 1, playing: true, onError }, start);
    for (let switchIndex = 1; switchIndex <= 6; switchIndex++) {
      // Every other switch lets the start finish and a frame begin (an advance in flight) before the next click.
      if (switchIndex % 2 === 0) {
        arrive(pending.length - 1, `r${switchIndex}`);
        await settle();
        frames.shift()?.();
      }
      session.close();
      session = openStageSession(create, { speed: 1, playing: true, onError }, start);
    }
    // The starts closed before they finished arrive late; then the current one arrives.
    pending.slice(0, -1).forEach((_, index) => { if (!resolved.has(index)) arrive(index, `late${index}`); });
    const last = arrive(pending.length - 1, "last");
    replays.pop();
    await settle();
    for (let frame = 0; frame < 3 && frames.length; frame++) { frames.shift()!(); await settle(); }
    expect(onError).not.toHaveBeenCalled();
    expect(replays.every((replay) => replay.disposed)).toBe(true);
    expect(last.disposed).toBe(false);
    expect(session.replay).toBe(last);
    expect(log.filter((line) => line === "last advance").length).toBeGreaterThan(0);
    session.close();
    expect(last.disposed).toBe(true);
  });

  describe("on one shared WebGPU canvas", () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it("opens a recorded state at its tick and reseeds from zero", async () => {
      const webgpu = webGpuStub();
      const device = webgpu.createDevice();
      const write = vi.spyOn(device.queue, "writeBuffer");
      const fine = new Float32Array(8 * 8 * 16).fill(0.25);
      const coarse = new Float32Array(4 * 4 * 16).fill(-0.5);
      const replay = await createFigureReplay({
        device, side: 8, seed: 7, initialState: { tick: 600, fine, coarse },
      }, PYRAMID_RULE, FIGURE_SHADERS);
      expect(replay.tick).toBe(600);
      expect(write.mock.calls.some((call) => call[2] instanceof Float32Array && call[2].length === fine.length && call[2][0] === 0.25)).toBe(true);
      expect(write.mock.calls.some((call) => call[2] instanceof Float32Array && call[2].length === coarse.length && call[2][0] === -0.5)).toBe(true);
      await replay.advance(1);
      expect(replay.tick).toBe(601);
      replay.reseed(8);
      expect(replay.tick).toBe(0);
      expect(replay.seed).toBe(8);
      replay.dispose();
    });

    it.each(["tick", "fine size", "coarse missing", "nonfinite"])("rejects an invalid recorded %s before allocating a GPU device", async (invalid) => {
      const webgpu = webGpuStub();
      const initialState = {
        tick: invalid === "tick" ? -1 : 600,
        fine: new Float32Array(invalid === "fine size" ? 1 : 8 * 8 * 16),
        coarse: invalid === "coarse missing" ? undefined : new Float32Array(4 * 4 * 16),
      };
      if (invalid === "nonfinite") initialState.fine[0] = Number.NaN;
      await expect(createFigureReplay({ side: 8, seed: 7, initialState }, PYRAMID_RULE, FIGURE_SHADERS)).rejects.toThrow();
      expect(webgpu.devices).toHaveLength(0);
    });

    it.each(["compute", "presentation", "context", "allocation"] as const)("releases partial initialization after a %s failure", async (failure) => {
      const webgpu = webGpuStub(failure);
      await expect(createFigureReplay({ canvas: webgpu.canvas, side: 8, seed: 1 }, RULE, FIGURE_SHADERS)).rejects.toThrow();
      expect(webgpu.liveBuffers()).toBe(0);
      expect(webgpu.devices.every((device) => device.destroyed)).toBe(true);
      expect(webgpu.configuredDevice).toBeUndefined();
    });

    it("releases failed allocations without destroying a supplied device", async () => {
      const webgpu = webGpuStub("compute");
      const device = webgpu.createDevice();
      await expect(createFigureReplay({ device, side: 8, seed: 1 }, RULE, FIGURE_SHADERS)).rejects.toThrow("compute failed");
      expect(webgpu.liveBuffers()).toBe(0);
      expect(device.destroyed).toBe(false);
    });

    // An older start still waiting when the next material starts must not configure,
    // unconfigure or draw on the canvas when it resolves; it releases only its own device.
    it.each<HoldPoint>(["device", "compute pipelines", "presentation pipeline"])(
      "holds the %s of an older start across a switch, and the new material keeps drawing",
      async (point) => {
        const webgpu = webGpuStub();
        const frames: (() => void)[] = [];
        const onError = vi.fn();
        const settle = async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); };
        const open = () => openStageSession(
          (signal) => createFigureReplay({ canvas: webgpu.canvas, side: 8, seed: 1, signal }, RULE, FIGURE_SHADERS),
          { speed: 1, playing: true, onError, schedule: (callback) => { frames.push(callback); } },
        );
        webgpu.holdNextStart(point);
        const older = open();
        await settle();
        older.close();
        const current = open();
        await settle();
        frames.shift()?.();
        await settle();
        const [olderDevice, currentDevice] = webgpu.devices;
        expect(webgpu.configuredDevice).toBe(currentDevice);

        webgpu.releaseHeld();
        await settle();
        for (let frame = 0; frame < 3 && frames.length; frame++) { frames.shift()!(); await settle(); }
        expect(olderDevice.destroyed).toBe(true);
        expect(currentDevice.destroyed).toBe(false);
        expect(webgpu.configuredDevice).toBe(currentDevice);
        expect(current.replay?.tick).toBeGreaterThan(1);
        expect(older.replay).toBeNull();
        expect(onError).not.toHaveBeenCalled();
        current.close();
      },
    );

    // A shared device can run multiple pyramid rules. Every replay must
    // release all it allocates, readback buffers included, whether it owns its device or not.
    it("releases every buffer across 50 switches between pyramid and cell materials, with readbacks", async () => {
      const webgpu = webGpuStub();
      const frames: (() => void)[] = [];
      const onError = vi.fn();
      const settle = async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); };
      let session: ReturnType<typeof openStageSession> | undefined;
      for (let index = 0; index < 50; index++) {
        session?.close();
        const rule = index % 2 === 0 ? PYRAMID_RULE : RULE;
        session = openStageSession(
          (signal) => createFigureReplay({ canvas: webgpu.canvas, side: 8, seed: 1, signal }, rule, FIGURE_SHADERS),
          { speed: 1, playing: true, onError, schedule: (callback) => { frames.push(callback); } },
        );
        await settle();
        frames.splice(0).forEach((frame) => frame());
        await settle();
        const replay = session.replay!;
        await replay.readPixels();
        await replay.readState();
        if (rule === PYRAMID_RULE) await replay.readCoarseState();
        await replay.stamp([{ x: 4, y: 4, radius: 2 }]);
        expect(webgpu.devices.filter((device) => !device.destroyed)).toHaveLength(1);
        // The live device holds its own buffers only: 2 states, rule, ticks, damage, view and pixels, plus a pyramid's 2 coarse states.
        expect(webgpu.liveBuffers()).toBe(rule === PYRAMID_RULE ? 9 : 7);
      }
      session!.close();
      expect(webgpu.liveBuffers()).toBe(0);
      expect(webgpu.devices.every((device) => device.destroyed)).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it("leaves a shared device with no buffers after each of 50 pyramid replays", async () => {
      const webgpu = webGpuStub();
      const device = webgpu.createDevice();
      for (let index = 0; index < 50; index++) {
        const replay = await createFigureReplay({ device, side: 8, seed: index }, PYRAMID_RULE, FIGURE_SHADERS);
        await replay.advance(70);
        await replay.readCoarseState();
        await replay.readPixels();
        replay.dispose();
        expect(webgpu.liveBuffers()).toBe(0);
      }
      expect(device.destroyed).toBe(false);
    });
  });
});
