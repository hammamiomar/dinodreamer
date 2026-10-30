// The safetensors files of the release that How reads in the page without the engine: the
// calibration and a block's frame. A file is an 8-byte little-endian
// header length, a JSON header naming each tensor's dtype, shape and byte range, then the data.

/** One float32 tensor of a safetensors file, checked against the shape the caller expects. */
export function readTensor(bytes: Uint8Array, name: string, shape: readonly number[]): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  if (8 + headerLength > bytes.byteLength) throw new Error("A release file has a malformed header.");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>;
  const tensor = header[name];
  const count = shape.reduce((product, size) => product * size, 1);
  if (!tensor || tensor.dtype !== "F32" || tensor.shape.join() !== shape.join() || tensor.data_offsets[1] - tensor.data_offsets[0] !== 4 * count) {
    throw new Error(`A release file lacks the float32 tensor ${name} [${shape.join(", ")}].`);
  }
  const start = 8 + headerLength + tensor.data_offsets[0];
  return Float32Array.from({ length: count }, (_, index) => view.getFloat32(start + 4 * index, true));
}
