// Saves the creation in progress to this device. The hook lives with the editor
// session above the routes, so it also saves edits made while browsing (tokens
// dropped on the docked canvas) and images that arrive while Create is closed.
//
// What it saves: a creation with a record, and a new creation with at least one
// request, unless it is a Gallery entry the visitor has not changed (the gallery rule,
// features/editor/state.ts). Such an entry gets no record and no reopen pointer, so
// leaving the page discards it; its first change makes it worth saving.
//
// When it saves:
//   - SAVE_DELAY_MS after the last numerical edit or title change, or after the
//     creation becomes worth saving (a Gallery entry's first change);
//   - SAVE_DELAY_MS after a new image while the run is paused (a pause, a step);
//   - every RUNNING_SAVE_INTERVAL_MS while running, if the image changed;
//   - at once when the page is hidden, so closing the tab keeps the last state.
// One save runs at a time, so the id of a first save is known before the next.
//
// Identity: `state.opened` counts creations opened in this session. A save
// records the generation it was taken from. Its acknowledgement can only name
// that generation's record, and a frame can only be that generation's image.
//
// The stored picture (`pictureToStore`): a record's picture, with its step, engine
// and upgrade mark (storage/creations.ts), is replaced only by a new image, one
// with at least one update of this session's run on it (`isNewImage`). A restored
// picture, a measurement of it, a re-seed and a Reset's seed image are not new.
// They must not overwrite a developed picture, its upgrade mark or its engine. A new
// record takes a new image; else the picture the creation was opened with (a
// Gallery entry), with that picture's engine and mark; else the image shown (a
// new canvas's seed image); else the placeholder square.

import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { EditorAction, EditorState, OpenedPicture, StoredPicture } from "../features/editor/state";
import { imageStartStep, latestShown } from "../features/editor/run/session";
import type { RunState } from "../features/editor/run/session";
import { saveCreation, type CreationInput } from "../storage/creations";
import { rememberLastCreation } from "../storage/last-creation";

/** Wait after the last edit before saving: one save per burst of edits. */
const SAVE_DELAY_MS = 1500;
/** While a run continues, the stored image is at most this old. */
const RUNNING_SAVE_INTERVAL_MS = 15_000;
const IMAGE_SIZE = 256;
/** The image of a new creation before its first frame. */
const BLANK_RGB = "#2a2733";

export type SaveStatus =
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; message: string };

/** The record id that a save in this generation acknowledged, before the reducer has applied it. */
export interface Acknowledged {
  opened: number;
  id: string;
}

/**
 * The record a save writes: the creation's own id, else the id a previous save
 * of the same generation created, else none (a new record). An acknowledgement
 * from an earlier creation never redirects a save.
 */
export function saveTarget(creation: { opened: number; savedId?: string }, acknowledged: Acknowledged | null): string | undefined {
  if (creation.savedId !== undefined) return creation.savedId;
  if (acknowledged && acknowledged.opened === creation.opened) return acknowledged.id;
  return undefined;
}

/**
 * The shown image if it was produced for the current creation: its revision is
 * at or after the revision at which the creation was opened. A frame of the
 * previous creation can still arrive after an open; it must not become this
 * creation's image.
 */
export function imageOfCreation(
  shown: { revision: number; step: number; pixels: Uint8ClampedArray } | undefined,
  openedAtRevision: number,
): { step: number; pixels: Uint8ClampedArray } | undefined {
  return shown && shown.revision >= openedAtRevision ? { step: shown.step, pixels: shown.pixels } : undefined;
}

/** The image the run shows for the current creation, with the step at which that image began (run/session.ts imageStartStep). */
export interface CreationImage {
  step: number;
  pixels: Uint8ClampedArray;
  startStep: number;
}

/** The run's image of the current creation (imageOfCreation), with the step at which that image began. */
export function creationImage(session: RunState, openedAtRevision: number): CreationImage | undefined {
  const shown = imageOfCreation(latestShown(session), openedAtRevision);
  return shown ? { ...shown, startStep: imageStartStep(session) } : undefined;
}

/** Whether the image is new: at least one update of this session's run is on it, so its step is past its start step. */
export function isNewImage(image: CreationImage): boolean {
  return image.step > image.startStep;
}

/** What a save stores as the record's picture (the stored-picture rule above). */
export type PictureToStore =
  /** The shown image, made by this client's engine build. */
  | { kind: "image"; step: number; pixels: Uint8ClampedArray }
  /** The picture the creation was opened with, with its own step, engine and mark. */
  | { kind: "opened"; picture: StoredPicture }
  | { kind: "placeholder" }
  /** No picture: the record keeps its own, with its step, engine and mark. */
  | { kind: "keep" };

/** The stored-picture rule. `generation` is the creation's `opened` count; an earlier generation's picture is not its own. */
export function pictureToStore(
  image: CreationImage | undefined,
  existingRecord: boolean,
  opened: OpenedPicture | null,
  generation: number,
): PictureToStore {
  if (image && isNewImage(image)) return { kind: "image", step: image.step, pixels: image.pixels };
  if (existingRecord) return { kind: "keep" };
  if (opened && opened.opened === generation) return { kind: "opened", picture: opened };
  if (image) return { kind: "image", step: image.step, pixels: image.pixels };
  return { kind: "placeholder" };
}

/**
 * The record a save writes: the creation's title and recipe, and the chosen picture with
 * what travels with it. A shown image or the placeholder names `engine`, this client's build;
 * an opened picture keeps its own engine (none when unknown) and mark. `encode` makes a PNG.
 */
export async function creationInput(
  creation: { id?: string; title: string; recipe: CreationInput["recipe"]; inks?: CreationInput["inks"] },
  picture: PictureToStore,
  engine: string,
  encode: (pixels: Uint8ClampedArray | undefined) => Promise<Blob> = pngOf,
): Promise<CreationInput> {
  switch (picture.kind) {
    case "keep":
      return creation;
    case "image":
      return { ...creation, previewPng: await encode(picture.pixels), step: picture.step, engine };
    case "placeholder":
      return { ...creation, previewPng: await encode(undefined), placeholder: true, engine };
    case "opened": {
      const { png, step, engine: madeBy, upgradedFrom } = picture.picture;
      return {
        ...creation,
        previewPng: new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        step,
        ...(madeBy ? { engine: madeBy } : {}),
        ...(upgradedFrom ? { upgradedFrom } : {}),
      };
    }
  }
}

/**
 * A creation that has a record is always saved. A new creation is saved once it has a
 * request, unless it is a Gallery entry the visitor has not changed (the gallery rule).
 */
export function worthSaving(state: Pick<EditorState, "recipe" | "savedId" | "fromGallery">): boolean {
  if (state.savedId !== undefined) return true;
  return state.recipe.requests.length > 0 && !state.fromGallery;
}

/** `engine` names the build that makes the images (RunHandle.engine); it is saved with every image. */
export function useCreationAutosave(state: EditorState, session: RunState, dispatch: Dispatch<EditorAction>, engine: string): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>({ kind: "unsaved" });

  // The revision at which the current creation was opened. Updated during render,
  // so the image test below never uses the previous creation's start.
  const generation = useRef({ opened: state.opened, revision: 0 });
  if (generation.current.opened !== state.opened) generation.current = { opened: state.opened, revision: state.revision };
  const image = creationImage(session, generation.current.revision);

  const latest = useRef({ state, image });
  latest.current = { state, image };
  const queue = useRef<Promise<void>>(Promise.resolve());
  const acknowledged = useRef<Acknowledged | null>(null);
  const savedImage = useRef<Uint8ClampedArray | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** A new image (the stored-picture rule) that no save has stored yet. */
  const imageChanged = () => {
    const current = latest.current.image;
    return current !== undefined && isNewImage(current) && current.pixels !== savedImage.current;
  };

  const saveNow = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    queue.current = queue.current.then(async () => {
      const { state: snapshot, image: snapshotImage } = latest.current;
      if (!worthSaving(snapshot)) return;
      const id = saveTarget(snapshot, acknowledged.current);
      const picture = pictureToStore(snapshotImage, id !== undefined, snapshot.openedPicture, snapshot.opened);
      setStatus({ kind: "saving" });
      try {
        // A run's image is saved with its step (Open continues from it); the placeholder
        // square is not a run's image, so Open does not continue from it.
        const input = await creationInput({ id, title: snapshot.title, recipe: snapshot.recipe, inks: snapshot.inks }, picture, engine);
        const saved = await saveCreation(input);
        acknowledged.current = { opened: snapshot.opened, id: saved.id };
        // The record to reopen on the next load: the one written most recently.
        rememberLastCreation(saved.id);
        dispatch({ type: "saved", savedId: saved.id, opened: snapshot.opened });
        if (latest.current.state.opened === snapshot.opened) {
          if (picture.kind === "image") savedImage.current = picture.pixels;
          setStatus({ kind: "saved", at: performance.now() });
        }
      } catch (error) {
        if (latest.current.state.opened === snapshot.opened) {
          setStatus({ kind: "failed", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
        }
      }
    });
  };
  const saveSoon = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(saveNow, SAVE_DELAY_MS);
  };
  // Effects below call the latest closures, so they need not re-subscribe on every render.
  const actions = useRef({ saveNow, saveSoon, imageChanged });
  actions.current = { saveNow, saveSoon, imageChanged };

  const worth = worthSaving(state);

  // A different creation starts with its own status and no image saved yet.
  useEffect(() => {
    savedImage.current = undefined;
    setStatus(latest.current.state.savedId ? { kind: "saved", at: performance.now() } : { kind: "unsaved" });
  }, [state.opened]);

  // Numerical edits, title changes, colour picks, and a Gallery entry's first change.
  useEffect(() => {
    if (worth) actions.current.saveSoon();
  }, [state.revision, state.title, state.inks, worth]);

  // A new image while paused: a pause or a single step.
  const imagePixels = image?.pixels;
  useEffect(() => {
    if (worth && !session.wantsRunning && actions.current.imageChanged()) actions.current.saveSoon();
  }, [imagePixels, session.wantsRunning, worth]);

  // While running, keep the stored image recent without saving every frame.
  useEffect(() => {
    if (!worth || !session.wantsRunning) return;
    const interval = setInterval(() => {
      if (actions.current.imageChanged()) actions.current.saveNow();
    }, RUNNING_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session.wantsRunning, worth]);

  // Closing or hiding the page saves what is waiting at once.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "visible") return;
      if (timer.current !== null || actions.current.imageChanged()) actions.current.saveNow();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  return status;
}

/** The image as PNG; before the first frame, a dark square. */
async function pngOf(pixels: Uint8ClampedArray | undefined): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const context = canvas.getContext("2d")!;
  if (pixels) {
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), IMAGE_SIZE, IMAGE_SIZE), 0, 0);
  } else {
    context.fillStyle = BLANK_RGB;
    context.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("could not encode the image"))), "image/png"),
  );
}
