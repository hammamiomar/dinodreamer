// The creation being edited, its run and its local save. All three live above
// the routes, so they survive moving between the library, the editor and the
// gallery: a run continues and its creation keeps saving while the visitor
// browses. The editor owns the reducer (features/editor/state.ts) and the run
// hook (features/editor/run/use-run.ts); this provider holds them, and tells the
// editor when the visitor's commands change the image (`useImageCommands`).
//
// The run hook starts the synthesis worker when it mounts, so it mounts only
// once the engine is wanted (engine-start.ts) and stays mounted from then on.
// It mounts beside the screens, never around them, so starting the engine
// remounts nothing; until then the session carries a dormant run.
//
// On load the editor reopens the creation this device's autosave wrote most
// recently (storage/last-creation.ts), so a reload, a crash or a deploy returns
// the visitor to the same creation; its run continues from the stored picture. A visitor
// with no record starts new. An unchanged Gallery entry has no record, so a reload does
// not bring it back.

import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, ReactNode } from "react";
import { useLocation } from "react-router";
import { areasLinked, canHoldRequest, createEditorState, editorReducer, paintableSelection, requestBlocks } from "../features/editor/state";
import { inkTable, type InkTable } from "../features/editor/inks";
import { defaultInkPairs } from "../features/editor/presentation";
import type { EditorAction, EditorState } from "../features/editor/state";
import { emptyRecording } from "../features/editor/run/recording";
import { createRunState } from "../features/editor/run/session";
import { useRun } from "../features/editor/run/use-run";
import type { RunHandle } from "../features/editor/run/use-run";
import { useTapDeselect } from "../features/editor/deselect";
import { RELEASE_NAME } from "./config";
import { useCreationAutosave } from "./creation-autosave";
import type { SaveStatus } from "./creation-autosave";
import { getCreation } from "../storage/creations";
import { beginOpen, openSavedAction } from "../features/editor/open-creation";
import { lastCreationId } from "../storage/last-creation";
import { engineWanted } from "./engine-start";

export interface EditorSession {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  run: RunHandle;
  /** The local save of this creation (creation-autosave.ts). */
  save: SaveStatus;
  /** Every request's two tones (inks.ts): the one source of the inks the screens draw with. */
  inks: InkTable;
}

const EditorSessionContext = createContext<EditorSession | null>(null);
/**
 * Dispatch alone, for screens that only hand work to the editor (block panel,
 * saves, gallery). Its value never changes, so those screens do not re-render
 * on every frame of a run.
 */
const EditorDispatchContext = createContext<Dispatch<EditorAction> | null>(null);

/**
 * What the library screens show of the creation's requests: their blocks (the Atlas's "In
 * use") and whether a reference patch has room (look/look-page.tsx). The value changes only
 * when one of them does, so those screens do not re-render on every frame either.
 */
interface CreationRequests {
  blocks: readonly number[];
  canHold: boolean;
}
const CreationRequestsContext = createContext<CreationRequests>({ blocks: [], canHold: true });

export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, RELEASE_NAME, createEditorState);
  useRestoreLastCreation(dispatch);
  // A tap outside what is selected clears the selection, on every screen (the deselect rule).
  const paints = paintableSelection(state.recipe, state.selectedTerm) !== null;
  useTapDeselect(state.selectedTerm, paints, () => dispatch({ type: "deselect" }));
  const { pathname } = useLocation();
  // Once wanted, the engine stays.
  const [started, setStarted] = useState(false);
  const wanted = started || engineWanted(pathname, state.recipe.requests.length);
  useEffect(() => {
    if (wanted) setStarted(true);
  }, [wanted]);

  const [running, setRunning] = useState<RunHandle | null>(null);
  const dormant = useDormantRun(state);
  const run = useImageCommands(running ?? dormant, dispatch);
  const save = useCreationAutosave(state, run.session, dispatch, run.engine);
  const blocks = useSameNumbers(requestBlocks(state));
  const canHold = canHoldRequest(state);
  const requests = useMemo(() => ({ blocks, canHold }), [blocks, canHold]);
  const { recipe, inks: choices, separateAreas } = state;
  const inks = useMemo(() => inkTable(recipe, choices, (id) => areasLinked({ separateAreas }, id), defaultInkPairs()), [recipe, choices, separateAreas]);
  return (
    <EditorDispatchContext.Provider value={dispatch}>
      {wanted && <RunSource state={state} onHandle={setRunning} />}
      <CreationRequestsContext.Provider value={requests}>
        <EditorSessionContext.Provider value={{ state, dispatch, run, save, inks }}>{children}</EditorSessionContext.Provider>
      </CreationRequestsContext.Provider>
    </EditorDispatchContext.Provider>
  );
}

/** The previous list while `numbers` holds the same values in the same order, so its identity marks a change. */
function useSameNumbers(numbers: number[]): readonly number[] {
  const kept = useRef<readonly number[]>(numbers);
  const same = kept.current.length === numbers.length && kept.current.every((value, index) => value === numbers[index]);
  if (!same) kept.current = numbers;
  return kept.current;
}

/**
 * Once, on load: reopens the last autosaved creation when its record is still there and
 * readable. It follows the open rule (features/editor/state.ts): if the visitor opens
 * something else, or edits the canvas or its title, before the record has loaded, the
 * restore gives way.
 */
function useRestoreLastCreation(dispatch: Dispatch<EditorAction>) {
  useEffect(() => {
    const id = lastCreationId();
    if (!id) return;
    let cancelled = false;
    const ticket = beginOpen(dispatch);
    getCreation(id)
      .then(async (record) => {
        if (cancelled) return;
        if (!record) {
          dispatch({ type: "cancelOpen", ticket });
          return;
        }
        const action = await openSavedAction(record, ticket);
        if (!cancelled) dispatch(action);
      })
      .catch(() => {
        // An unreadable or unavailable record: the editor starts new, and Saved lists the record as it is.
        if (!cancelled) dispatch({ type: "cancelOpen", ticket });
      });
    return () => {
      cancelled = true;
      dispatch({ type: "cancelOpen", ticket });
    };
  }, [dispatch]);
}

/** Holds the run hook, and with it the worker; reports each handle to the provider. */
function RunSource({ state, onHandle }: { state: EditorState; onHandle: (run: RunHandle) => void }) {
  const run = useRun(state);
  useEffect(() => onHandle(run), [run, onHandle]);
  return null;
}

/**
 * The run as the screens use it. Play, Step and a Noise stroke's re-seed change the image,
 * so each also tells the editor (`changeImage`): a Gallery entry becomes the visitor's
 * (the gallery rule, features/editor/state.ts). Pause and Reset change nothing of it.
 */
function useImageCommands(run: RunHandle, dispatch: Dispatch<EditorAction>): RunHandle {
  return useMemo(
    () => ({
      ...run,
      run: () => {
        dispatch({ type: "changeImage" });
        run.run();
      },
      step: () => {
        dispatch({ type: "changeImage" });
        run.step();
      },
      reseed: (cells: boolean[], seed: number) => {
        dispatch({ type: "changeImage" });
        run.reseed(cells, seed);
      },
    }),
    [run, dispatch],
  );
}

const DORMANT_RUN_STATE = createRunState();
const DORMANT_RECORDING = emptyRecording();
const nothing = () => {};

/** The run before any engine is wanted: idle, and it makes no images, so its engine name is empty. */
function useDormantRun(state: EditorState): RunHandle {
  return useMemo(
    () => ({
      session: DORMANT_RUN_STATE,
      desired: { revision: state.revision, recipe: state.recipe },
      engine: "",
      recording: DORMANT_RECORDING,
      run: nothing,
      pause: nothing,
      step: nothing,
      restart: nothing,
      reseed: nothing,
    }),
    [state.revision, state.recipe],
  );
}

export function useEditorSession(): EditorSession {
  const session = useContext(EditorSessionContext);
  if (!session) throw new Error("useEditorSession needs EditorSessionProvider");
  return session;
}

/** The blocks of the creation's requests and of the held token, in order, each once; the same array until they change. */
export function useRequestBlocks(): readonly number[] {
  return useContext(CreationRequestsContext).blocks;
}

/** Whether a clicked token can be held: the creation has room for one more request. */
export function useCanHoldRequest(): boolean {
  return useContext(CreationRequestsContext).canHold;
}

export function useEditorDispatch(): Dispatch<EditorAction> {
  const dispatch = useContext(EditorDispatchContext);
  if (!dispatch) throw new Error("useEditorDispatch needs EditorSessionProvider");
  return dispatch;
}
