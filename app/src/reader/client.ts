import type { ReleaseLocation } from "../synthesis/protocol";
import type { ImageAddresses, ReaderCommand, ReaderEvent } from "./protocol";

export interface ReaderProgress { message: string; done: number; total: number }

/** One reader worker. The caller owns the displayed crop and the lifetime. */
export class ReaderClient {
  readonly ready: Promise<void>;
  private worker = new Worker(new URL("./reader.worker.ts", import.meta.url), { type: "module" });
  private serial = 0;
  private failure?: Error;
  private pending = new Map<number, { resolve: (value: ImageAddresses) => void; reject: (error: Error) => void }>();
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(location: ReleaseLocation, onProgress?: (progress: ReaderProgress) => void) {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // A caller may wait to read until loading finishes. Retain rejection for that caller.
    void this.ready.catch(() => {});
    this.worker.onmessage = ({ data }: MessageEvent<ReaderEvent>) => {
      if (data.type === "ready") this.resolveReady();
      else if (data.type === "progress") onProgress?.(data);
      else if (data.type === "failed" && data.id === undefined) this.fail(new Error(data.message));
      else if (data.type === "image-addresses" || data.type === "failed") {
        const request = this.pending.get(data.id!);
        if (!request) return;
        this.pending.delete(data.id!);
        if (data.type === "failed") request.reject(new Error(data.message));
        else request.resolve(data.addresses);
      }
    };
    this.worker.onerror = (event) => this.fail(new Error(event.message || "Image analyzer worker could not start or stopped unexpectedly."));
    this.worker.onmessageerror = () => this.fail(new Error("An image analyzer message could not be decoded."));
    this.post({ type: "load", release: location });
  }

  async readImage(pixels: Uint8ClampedArray): Promise<ImageAddresses> {
    if (pixels.length !== 256 * 256 * 4) throw new Error("Read a 256 × 256 opaque RGBA image.");
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 255) throw new Error("Composite transparent pixels before reading the image.");
    }
    // Snapshot now, before loading finishes or the caller changes its display buffer.
    const snapshot = pixels.slice();
    await this.ready;
    if (this.failure) throw this.failure;
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "read-image", id, pixels: snapshot }, [snapshot.buffer]);
    });
  }

  private post(command: ReaderCommand, transfer: Transferable[] = []) {
    this.worker.postMessage(command, transfer);
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.rejectReady(error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
  dispose() { this.fail(new Error("Image analyzer closed")); }
}
