// The figures' shared records: the page's picture, dictionary and training history, opened once.
import { useEffect, useState } from "react";
import { RELEASE_LOCATION } from "../../../app/config";
import { readStory, STORY_FILE, type StoryRecord } from "../training-story";
import { HOW_PICTURE, loadRecord, recordedSource, releaseDictionary, type HowSource } from "../how-source";
import type { RecordedPicture } from "../recorded";

let opened: Promise<{ record: RecordedPicture; source: HowSource }> | null = null;

/** The page's source, opened once: the record.json of the picture and the release's dictionary files. */
export function openHowSource(): Promise<{ record: RecordedPicture; source: HowSource }> {
  return (opened ??= (async () => {
    const record = await loadRecord(HOW_PICTURE.imageId);
    return { record, source: recordedSource(HOW_PICTURE.imageId, record, releaseDictionary(RELEASE_LOCATION)) };
  })().catch((error: unknown) => {
    opened = null;
    throw error;
  }));
}

export type HowSourceState =
  | { status: "loading" }
  | { status: "ready"; record: RecordedPicture; source: HowSource }
  | { status: "failed"; message: string };

export function useHowSource(): HowSourceState {
  const [state, setState] = useState<HowSourceState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    openHowSource().then(
      ({ record, source }) => current && setState({ status: "ready", record, source }),
      (error: unknown) => current && setState({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => { current = false; };
  }, []);
  return state;
}

/** The page's automaton: the featured two-scale automaton of group 4009, trained toward the followed patch. */
export const HOW_AUTOMATON = "block-4009-figure-pyramid-strongest-seed-0";
/** Regrow after the recorded reading at tick 600, before the picture can dissolve. */
export const HOW_REGROW_AT_TICK = 800;

let story: Promise<StoryRecord> | null = null;

/** The home's story record of the page's automaton: its anchor's place in the cloud and its training strip. */
export function loadHowStory(): Promise<StoryRecord> {
  return (story ??= fetch(STORY_FILE)
    .then((response) => {
      if (!response.ok) throw new Error(`${STORY_FILE} answered ${response.status}`);
      return response.json();
    })
    .then((value) => {
      const record = readStory(value).records.find((entry) => entry.material === HOW_AUTOMATON);
      if (!record) throw new Error(`The story has no record of ${HOW_AUTOMATON}.`);
      return record;
    })
    .catch((error: unknown) => {
      story = null;
      throw error;
    }));
}
