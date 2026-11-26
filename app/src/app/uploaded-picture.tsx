import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ImageAddresses } from "../reader/protocol";
import { pictureReadout, preparePicture, type PictureReadout, type PreparedPicture } from "../features/look/picture-readout";
import { useObjectUrl } from "../ui/files";
import { LOOK_TEXT } from "../features/look/look-text";

export interface PictureReaderProgress { message: string; done: number; total: number }
export interface PictureProgress { done: number; total: number }
export interface PictureReaderConnection {
  readonly ready?: Promise<void>;
  readImage(pixels: Uint8ClampedArray): Promise<ImageAddresses>;
  dispose(): void;
}
type ReaderFactory = (onProgress: (progress: PictureReaderProgress) => void) => PictureReaderConnection;

const ANALYZING_PATCHES_MESSAGE = "Analyzing 256 image patches on WebGPU…";

interface PictureState {
  revision: number;
  picture: PreparedPicture | null;
  readout: PictureReadout | null;
  phase: "empty" | "preparing" | "ready" | "reading" | "failed";
  message: string;
  progress: PictureProgress | null;
}
interface UploadedPictureState extends PictureState {
  previewUrl: string | null;
  choose(file: File): Promise<void>;
  read(): Promise<void>;
  clear(): void;
}
const EMPTY_PICTURE: PictureState = { revision: 0, picture: null, readout: null, phase: "empty", message: "", progress: null };
const UploadedPictureContext = createContext<UploadedPictureState | null>(null);

/** Picture and addresses survive block navigation; an old read cannot replace a newer upload. */
export function UploadedPictureProvider({ children, createReader }: { children: ReactNode; createReader: ReaderFactory }) {
  const [state, setState] = useState<PictureState>(EMPTY_PICTURE);
  const version = useRef(0);
  const reader = useRef<PictureReaderConnection | null>(null);
  const previewUrl = useObjectUrl(state.picture?.preview ?? null);
  useEffect(() => () => { version.current++; reader.current?.dispose(); reader.current = null; }, []);

  async function choose(file: File) {
    const revision = ++version.current;
    if (state.phase === "reading") {
      reader.current?.dispose();
      reader.current = null;
    }
    setState({ ...EMPTY_PICTURE, revision, phase: "preparing", message: LOOK_TEXT.upload.preparing });
    try {
      const picture = await preparePicture(file);
      if (version.current === revision) await readPreparedPicture(picture, revision);
    } catch (error) {
      if (version.current === revision) setState({ ...EMPTY_PICTURE, revision, phase: "failed", message: LOOK_TEXT.upload.notOpened(errorMessage(error)) });
    }
  }

  async function read() {
    if (!state.picture || state.phase === "reading") return;
    await readPreparedPicture(state.picture, version.current);
  }

  async function readPreparedPicture(picture: PreparedPicture, revision: number) {
    let connection: PictureReaderConnection | null = null;
    setState({ revision, picture, readout: null, phase: "reading", message: LOOK_TEXT.upload.starting, progress: null });
    try {
      if (!reader.current) {
        reader.current = createReader((update) => {
          setState((current) =>
            current.phase === "reading"
              ? {
                  ...current,
                  message: update.message,
                  progress: update.total > 0 ? { done: update.done, total: update.total } : null,
                }
              : current,
          );
        });
      }
      connection = reader.current;
      // Once weights finish loading, surface the WebGPU patch-encoding step until readImage resolves.
      if (connection.ready) {
        void connection.ready.then(
          () => {
            if (version.current !== revision) return;
            setState((current) =>
              current.phase === "reading" && current.revision === revision
                ? { ...current, message: ANALYZING_PATCHES_MESSAGE, progress: { done: 1, total: 1 } }
                : current,
            );
          },
          () => {
            // Rejection is surfaced through the awaited readImage call below.
          },
        );
      }
      // ReaderClient snapshots the input before it waits for its assets.
      const addresses = await connection.readImage(picture.pixels);
      if (version.current !== revision) return;
      const readout = pictureReadout(addresses);
      setState({ revision, picture, readout, phase: "ready", message: "", progress: null });
    } catch (error) {
      // A failed device or load must get a fresh connection on Retry.
      if (reader.current === connection) {
        connection?.dispose();
        reader.current = null;
      }
      if (version.current === revision) {
        setState((current) => ({ ...current, phase: "failed", message: LOOK_TEXT.upload.notRead(errorMessage(error)), progress: null }));
      }
    }
  }

  function clear() {
    const revision = ++version.current;
    if (state.phase === "reading") {
      reader.current?.dispose();
      reader.current = null;
    }
    setState({ ...EMPTY_PICTURE, revision });
  }

  const value: UploadedPictureState = {
    ...state,
    previewUrl,
    choose,
    read,
    clear,
  };
  return <UploadedPictureContext.Provider value={value}>{children}</UploadedPictureContext.Provider>;
}

export function useUploadedPicture(): UploadedPictureState {
  const state = useContext(UploadedPictureContext);
  if (!state) throw new Error("useUploadedPicture needs UploadedPictureProvider.");
  return state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
