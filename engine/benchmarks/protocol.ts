import type { OptimizerSpec } from "../../app/src/synthesis/objective";

/** The engine's frame summary; the workload is always tools/fixtures/evidence-recipe.json. */
export interface Frame {
  step: number;
  loss: number;
  views: number;
  pixels: Uint8ClampedArray;
  gpuUsedBytes?: number;
  gpuReservedBytes?: number;
}

export interface BenchmarkSettings {
  warmup: number;
  steps: number;
  profileSteps: number;
  seed: number;
}

export interface Capabilities {
  adapter: {
    name: string;
    vendor: number;
    device: number;
    device_type: string;
    driver: string;
    driver_info: string;
    backend: string;
    is_fallback: boolean;
  };
  features: string;
  timestamps: boolean;
  shader_f16: boolean;
  limits: Record<string, number>;
  precision: Record<string, string>;
  features_build: { fusion: boolean; autotune: boolean };
}

export interface Comparison {
  name: string;
  shape: number[];
  relative_rms: number;
  max_absolute: number;
  tolerance: number;
  absolute_tolerance?: number;
  passed: boolean;
}

export interface Qualification {
  passed: boolean;
  checks: Comparison[];
  profile_equivalence: string;
}

export interface PoolMemory {
  used_bytes: number;
  reserved_bytes: number;
  allocations: number;
}

export interface StageTime {
  stage: string;
  method: string;
  milliseconds: number | null;
}

export type Mode = "compute" | "frame" | "profile";

export interface StepSample {
  step: number;
  worker_ms: number;
  round_trip_ms: number;
  /** Host graph execution and command submission. Overlaps GPU execution. */
  submission_ms?: number;
  before: PoolMemory | null;
  after: PoolMemory | null;
  loss?: number;
  stages?: StageTime[];
}

export interface Loaded {
  capabilities: Capabilities;
  manifestId: string;
  targetPath: string;
  /** Absent when reading a report without optimizer metadata. */
  optimizer?: OptimizerSpec;
  startup: {
    wasm_ms: number;
    device_ms: number;
    assets_ms: number;
    total_ms: number;
  };
  cacheHits: number;
  networkRequests: number;
  networkBytes: number;
}

/** Per call, one encoder block's matrix product at the update's shapes (harness_product_timings). */
export interface ProductTiming {
  name: string;
  forward_ms: number;
  forward_backward_ms: number;
  forward_tflops: number;
  forward_backward_tflops: number;
}

/** One frame-mode update split in time (harness_frame_breakdown). */
export interface FrameBreakdown {
  /** True: the readback waited for the GPU queue first; false: as in step(). */
  waitFirst: boolean;
  submission_ms: number;
  gpu_wait_ms: number;
  readback_ms: number;
  conversion_ms: number;
  total_ms: number;
}

export interface ModeResult {
  first: StepSample;
  warmup: StepSample[];
  samples: StepSample[];
  final: { step: number; loss: number };
}

export interface BrowserResult {
  settings: BenchmarkSettings;
  qualification?: Qualification;
  qualificationLoad?: Loaded;
  performanceLoad?: Loaded;
  modes: Partial<Record<Mode, ModeResult>>;
  products?: ProductTiming[];
  frameBreakdown?: FrameBreakdown[];
  profileUnavailable?: string;
  error?: string;
}

export type Request =
  | { type: "load"; releaseUrl: string; settings: BenchmarkSettings }
  | { type: "qualify"; fixtureUrl: string }
  | { type: "restart"; seed: number }
  | { type: "step"; mode: Mode }
  | { type: "measure" }
  | { type: "products" }
  | { type: "frame-breakdown"; waitFirst: boolean };

export interface StepReply extends Omit<StepSample, "round_trip_ms"> {
  frame?: Frame;
}

export type BenchmarkEvent =
  | { type: "phase"; message: string }
  | { type: "check"; check: Comparison }
  | { type: "sample"; mode: Mode; sample: StepSample; warmup: boolean };
