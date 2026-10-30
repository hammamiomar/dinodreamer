/**
 * Whether a failure ends the worker's session. The engine returns its errors as strings and
 * keeps its state, so once the model is loaded a string costs only the command that raised it
 * (the update or apply) and the session pauses. Before the model is loaded nothing can go on,
 * so any failure inside the load ends the session; so does anything that is not an engine
 * string: a WASM trap, a lost device, an engine module that would not load.
 */
export function endsSession(error: unknown, modelLoaded: boolean): boolean {
  return typeof error !== "string" || !modelLoaded;
}
