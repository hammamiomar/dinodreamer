// The owner's names for the basis groups (app/src/features/gallery/basis-groups.ts), stored as one
// object on the public bucket: published/basis-groups.json. The public Worker serves it
// (GET /api/basis-groups, worker.ts); the owner's view sets one name at a time (admin.ts).

import {
  BASIS_GROUP_NAMES_KEY, NO_NAMES, readBasisGroupNames, withName, type BasisGroupNames,
} from "../../app/src/features/gallery/basis-groups.ts";
import { CACHE_INDEX, type Bucket } from "./storage.ts";

/** The stored names, or none before the owner has named a group. */
export async function storedNames(library: Bucket): Promise<BasisGroupNames> {
  const stored = await library.get(BASIS_GROUP_NAMES_KEY);
  return stored === null ? NO_NAMES : readBasisGroupNames(JSON.parse(await stored.text()));
}

/** Set one group's name, or clear it with an empty one. One write; none when the name is already as asked. */
export async function setName(library: Bucket, block: number, name: string): Promise<BasisGroupNames> {
  const before = await storedNames(library);
  const after = withName(before, block, name);
  if (after !== before) {
    await library.put(BASIS_GROUP_NAMES_KEY, JSON.stringify(after, null, 2), {
      httpMetadata: { contentType: "application/json", cacheControl: CACHE_INDEX },
    });
  }
  return after;
}
