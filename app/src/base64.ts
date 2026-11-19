// Chunked base64 codecs for binary payloads such as cellular model weights and PNG bytes.
// Written in plain erasable TypeScript so Node scripts in gallery/ can import it directly.

const BASE64_CHUNK_BYTES = 0x8000;

/** Encode bytes to standard base64 in bounded chunks to stay under argument limits. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** Decode standard base64 text into a fresh ArrayBuffer-backed byte array. */
export function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
