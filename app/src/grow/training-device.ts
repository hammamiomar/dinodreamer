/** The shorter screen side in CSS pixels used by Train's phone notice and batch policy. */
const PHONE_SIDE = 600;

export function onPhone(): boolean {
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < PHONE_SIDE;
}

/** Use the smaller batch for new phone runs. An explicit batch permits comparisons. */
export function trainingBatch(search = globalThis.location?.search): 1 | 4 {
  const requested = new URLSearchParams(search).get("growBatch");
  if (requested === "1") return 1;
  if (requested === "4") return 4;
  return onPhone() ? 1 : 4;
}
