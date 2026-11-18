// Install in an isolated timing run, before a device is requested. Measure passes in every
// 16th encoder. Per-pass timestamps exclude queueing and distinguish device time from frame time.
export function profileWebGPU(stride = 16) {
  if (!globalThis.GPUDevice || globalThis.auditGPU) return;
  const log = (globalThis.auditGPU = {
    supported: [],
    allocated: 0,
    alive: 0,
    peak: 0,
    submits: 0,
    encoders: 0,
    samples: [],
    errors: [],
  });
  const allocate = GPUDevice.prototype.createBuffer;
  const sizes = new WeakMap();
  GPUDevice.prototype.createBuffer = function (descriptor) {
    const buffer = allocate.call(this, descriptor);
    sizes.set(buffer, buffer.size);
    log.allocated += buffer.size;
    log.alive += buffer.size;
    log.peak = Math.max(log.peak, log.alive);
    return buffer;
  };
  const destroy = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function () {
    log.alive -= sizes.get(this) ?? 0;
    sizes.delete(this);
    return destroy.call(this);
  };
  const request = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = function (descriptor = {}) {
    const supported = this.features.has("timestamp-query");
    log.supported.push({ supported, vendor: this.info.vendor });
    if (!supported) return request.call(this, descriptor);
    const features = new Set(descriptor.requiredFeatures ?? []);
    features.add("timestamp-query");
    return request.call(this, { ...descriptor, requiredFeatures: [...features] });
  };
  const recorded = new WeakMap();
  const pending = new WeakMap();
  const create = GPUDevice.prototype.createCommandEncoder;
  GPUDevice.prototype.createCommandEncoder = function (descriptor) {
    const encoder = create.call(this, descriptor);
    if (++log.encoders % stride === 0 && this.features.has("timestamp-query")) {
      recorded.set(encoder, {
        device: this,
        labels: [],
        queries: this.createQuerySet({ type: "timestamp", count: 256 }),
      });
    }
    return encoder;
  };
  for (const method of ["beginComputePass", "beginRenderPass"]) {
    const begin = GPUCommandEncoder.prototype[method];
    GPUCommandEncoder.prototype[method] = function (descriptor = {}) {
      const sample = recorded.get(this);
      if (!sample || sample.labels.length === 128 || descriptor.timestampWrites)
        return begin.call(this, descriptor);
      const index = 2 * sample.labels.length;
      sample.labels.push(descriptor.label ?? method);
      return begin.call(this, {
        ...descriptor,
        timestampWrites: {
          querySet: sample.queries,
          beginningOfPassWriteIndex: index,
          endOfPassWriteIndex: index + 1,
        },
      });
    };
  }
  const finish = GPUCommandEncoder.prototype.finish;
  GPUCommandEncoder.prototype.finish = function (descriptor) {
    const sample = recorded.get(this);
    if (!sample?.labels.length) {
      sample?.queries.destroy();
      return finish.call(this, descriptor);
    }
    const count = 2 * sample.labels.length;
    const size = count * 8;
    sample.results = allocate.call(sample.device, {
      size,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    sample.readback = allocate.call(sample.device, {
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.resolveQuerySet(sample.queries, 0, count, sample.results, 0);
    this.copyBufferToBuffer(sample.results, 0, sample.readback, 0, size);
    const buffer = finish.call(this, descriptor);
    pending.set(buffer, sample);
    return buffer;
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    const list = Array.from(buffers);
    submit.call(this, list);
    log.submits++;
    for (const buffer of list) {
      const sample = pending.get(buffer);
      if (!sample) continue;
      const at = performance.now();
      sample.readback
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const times = new BigUint64Array(sample.readback.getMappedRange());
          const durations = sample.labels.map((label, i) => [
            label,
            Number(times[2 * i + 1] - times[2 * i]) / 1e6,
          ]);
          log.samples.push({ at, durations });
          sample.readback.unmap();
        })
        .catch((error) => log.errors.push(String(error)))
        .finally(() => {
          sample.queries.destroy();
          sample.results.destroy();
          sample.readback.destroy();
        });
    }
  };
}
