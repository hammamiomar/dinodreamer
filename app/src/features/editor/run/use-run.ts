// Connects the editor to a synthesis client. Mounted once, above the routes, so a
// run continues while the visitor browses. The hook owns the client's lifetime;
// session.ts decides what to send.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ENGINE_BUILD_NAME, RELEASE_LOCATION } from "../../../app/config";
import { createSynthesisClient, type SynthesisClient } from "../../../synthesis/client";
import { createFakeSynthesisClient } from "../../../synthesis/fake";
import type { EditorState } from "../state";
import { encodeStill } from "../video/stills";
import { useRecording, type Recording } from "./recording";
import { rememberModelLoaded } from "./model-download";
import { createRunState, modelLoaded, planCommand, runReducer, type DesiredRecipe, type RunState } from "./session";

export interface RunHandle {
  session: RunState;
  /** The editor's latest recipe and revision, as the session compares them with what is applied. */
  desired: DesiredRecipe;
  /** Which engine makes the images: the engine build's name, or "fake"; saved with every image. */
  engine: string;
  /** The stills kept of this image's run, for Save video (run/recording.ts). */
  recording: Recording;
  /** Run; after a fatal error, replace the client first (the model comes from the browser cache). */
  run(): void;
  pause(): void;
  step(): void;
  /** A fresh noise image from `seed`. Set the recipe's seed with the editor's setSeed action too. */
  restart(seed: number): void;
  /** Re-seed the image under `cells` from `seed`; ignored before the first objective is applied. */
  reseed(cells: boolean[], seed: number): void;
}

type EngineChoice = "fake" | "real";

/**
 * Which engine runs: the fake one with `?engine=fake` and in the fixture release, which
 * carries no model files, else the real worker. It is chosen once, when the run starts:
 * in-app navigation drops the query, so the client, its replacement
 * after a failure and the engine name saved with every image all keep the first choice.
 */
function chooseEngine(): EngineChoice {
  const fakeRequested = new URLSearchParams(window.location.search).get("engine") === "fake";
  return fakeRequested || import.meta.env.MODE === "fixtures" ? "fake" : "real";
}

function createClient(choice: EngineChoice): SynthesisClient {
  return choice === "fake" ? createFakeSynthesisClient() : createSynthesisClient();
}

/** The name saved with every image as its provenance. */
function engineName(choice: EngineChoice): string {
  return choice === "fake" ? "fake" : ENGINE_BUILD_NAME;
}

export function useRun(editor: EditorState): RunHandle {
  const [engine] = useState(chooseEngine);
  const [session, dispatch] = useReducer(runReducer, undefined, createRunState);
  const clientRef = useRef<SynthesisClient | null>(null);
  /** Increments to replace a client that failed fatally; such a worker only accepts dispose. */
  const [clientGeneration, setClientGeneration] = useState(0);

  useEffect(() => {
    const client = createClient(engine);
    clientRef.current = client;
    const unsubscribe = client.subscribe((event) => dispatch({ type: "event", event, receivedAt: performance.now() }));
    if (clientGeneration > 0) dispatch({ type: "clientReplaced" });
    return () => {
      unsubscribe();
      client.dispose();
      clientRef.current = null;
    };
  }, [clientGeneration, engine]);

  // An opened creation continues from its saved picture, or gets a fresh image from
  // its own seed, never the previous creation's pixels. Before the first apply there is no
  // image: a restart is ignored then, a restore waits for the apply. A creation opened before
  // this hook mounted (reopened on load while the engine was not yet wanted) still restores.
  // The opened creation waits for Run: a run going on the creation before does not continue
  // on it, so only the visitor's own Run or Step changes an opened Gallery entry (the gallery
  // rule, state.ts).
  const handledOpened = useRef<number | null>(editor.openedPicture?.opened === editor.opened ? null : editor.opened);
  useEffect(() => {
    if (handledOpened.current === editor.opened) return;
    handledOpened.current = editor.opened;
    dispatch({ type: "requestPause" });
    const picture = editor.openedPicture;
    if (picture && picture.opened === editor.opened) {
      const { png, step, revision, opened } = picture;
      dispatch({ type: "requestRestore", restore: { picture: png, step, afterRevision: revision, opened } });
    } else {
      dispatch({ type: "requestRestart", seed: editor.recipe.seed });
    }
  }, [editor.opened, editor.openedPicture, editor.recipe.seed]);

  const desired = useMemo(
    () => ({ revision: editor.revision, recipe: editor.recipe }),
    [editor.revision, editor.recipe],
  );
  const recording = useRecording(session, encodeStill);

  // Once the worker holds the model, this browser has it: later visits run without asking first (model-download.ts).
  const loaded = modelLoaded(session);
  useEffect(() => {
    if (loaded) rememberModelLoaded();
  }, [loaded]);

  // Send at most one planned command per render; recording it changes the plan.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const command = planCommand(session, desired, RELEASE_LOCATION);
    if (!command) return;
    client.send(command);
    dispatch({ type: "sent", command });
  }, [session, desired]);

  return useMemo(
    () => ({
      session,
      desired,
      engine: engineName(engine),
      recording,
      run: () => {
        const failed = session.phase === "failed" || session.error?.fatal === true;
        if (failed) setClientGeneration((generation) => generation + 1);
        else dispatch({ type: "requestRun" });
      },
      pause: () => dispatch({ type: "requestPause" }),
      step: () => dispatch({ type: "requestStep" }),
      restart: (seed: number) => dispatch({ type: "requestRestart", seed }),
      reseed: (cells: boolean[], seed: number) => dispatch({ type: "requestReseed", cells, seed }),
    }),
    [session, desired, recording, engine],
  );
}
