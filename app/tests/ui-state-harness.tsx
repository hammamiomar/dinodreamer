import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useMediaMatch } from "../src/ui/media-match";
import { useMovingValues } from "../src/ui/tween";
import { useLoaded } from "../src/ui/use-loaded";
import { useSourced } from "../src/features/how/use-sourced";
import type { HowSource } from "../src/features/how/how-source";
import { useCreationAutosave } from "../src/app/creation-autosave";
import { createEditorState, editorReducer } from "../src/features/editor/state";
import { createRunState } from "../src/features/editor/run/session";
import { createRequest } from "../src/features/editor/model";

function MediaQuery() {
  const [query, setQuery] = useState("(min-width: 2000px)");
  const matches = useMediaMatch(query);
  return <><button onClick={() => setQuery("(min-width: 1px)")}>Change query</button><output>{String(matches)}</output></>;
}

function MovingValues() {
  const [target, setTarget] = useState([0]);
  const [instant, setInstant] = useState(false);
  const shown = useMovingValues(target, { instant });
  return <><button onClick={() => setTarget([100])}>Move</button><button onClick={() => setInstant(true)}>Finish now</button><output>{shown[0]}</output></>;
}

const source = {} as HowSource;
function LoadingValues() {
  const loaded = useLoaded("failed", () => { throw new Error("Load failed"); });
  const sourced = useSourced(source, () => { throw new Error("Source failed"); });
  return <><output id="loaded">{loaded.status === "failed" ? loaded.message : loaded.status}</output><output id="sourced">{sourced.status === "failed" ? sourced.message : sourced.status}</output></>;
}

function Autosave() {
  const [state, setState] = useState(() => {
    const initial = createEditorState("fixture");
    return { ...initial, recipe: createRequest(initial.recipe, { block: 1, token: { imageId: 1, role: "patch", slot: 5 }, code: [1, 0, 0] }) };
  });
  const [session] = useState(createRunState);
  const [completed, setCompleted] = useState(0);
  const status = useCreationAutosave(state, session, (action) => {
    setCompleted((value) => value + 1);
    setState((current) => editorReducer(current, action));
  }, "browser-test");
  return <><button onClick={() => setState({ ...createEditorState("fixture"), opened: state.opened + 1, revision: state.revision + 1 })}>New creation</button><output id="status">{status.kind}</output><output id="completed">{completed}</output></>;
}

const scenario = new URLSearchParams(location.search).get("case");
const component = scenario === "media" ? <MediaQuery /> : scenario === "moving" ? <MovingValues /> : scenario === "loading" ? <LoadingValues /> : <Autosave />;
createRoot(document.getElementById("root")!).render(<StrictMode>{component}</StrictMode>);
