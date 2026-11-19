import type { BrowserEngine } from "dinodreamer-engine";
import { loadReaderEngine } from "./load-engine";
import type { ImageAddresses, ReaderCommand, ReaderEvent } from "./protocol";

let engine: BrowserEngine | undefined;
let dictionaryId: string | undefined;
let queue = Promise.resolve();
const send = (event: ReaderEvent, transfer: Transferable[] = []) => self.postMessage(event, { transfer });

async function execute(command: ReaderCommand) {
  if (command.type === "load") {
    engine?.free();
    engine = undefined;
    dictionaryId = undefined;
    const loaded = await loadReaderEngine(
      command.release,
      (message, done, total) => send({ type: "progress", message, done, total }),
      (message) => send({ type: "failed", message }),
    );
    engine = loaded.engine;
    dictionaryId = loaded.dictionaryId;
    send({ type: "ready" });
  } else if (command.type === "read-image") {
    if (!engine || !dictionaryId) throw new Error("The image reader is not loaded yet.");
    const pixels = new Uint8Array(command.pixels.buffer, command.pixels.byteOffset, command.pixels.byteLength);
    const result = await engine.read_image(pixels);
    const addresses: ImageAddresses = { ...result, dictionaryId };
    send({ type: "image-addresses", id: command.id, addresses },
      [addresses.blocks.buffer, addresses.codes.buffer, addresses.norms.buffer]);
  } else {
    engine?.free();
    engine = undefined;
    dictionaryId = undefined;
    self.close();
  }
}

self.onmessage = ({ data }: MessageEvent<ReaderCommand>) => {
  queue = queue.then(async () => {
    try { await execute(data); }
    catch (error) { send({ type: "failed", id: data.type === "read-image" ? data.id : undefined, message: String(error) }); }
  });
};
