// The authenticated owner routes and their ordinary storage operations, on isolated memory buckets.
import { createServer } from "node:http";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";
import worker from "../../gallery/src/worker.ts";
import { checkedMaterial, materialPoster, storeMaterialSubmission } from "../../gallery/src/material-review.ts";
import { storeSubmission } from "../../gallery/src/submission.ts";
import { approve } from "../../gallery/src/review.ts";
import { sharpThumbnail } from "../../gallery/src/thumbnail-sharp.ts";
import { PNG, recipe, testEnv } from "../../gallery/test/fixtures.ts";

export async function startOwnerWorker(definition, appUrl) {
  const { env, submissions, library } = testEnv();
  env.ADMIN_LOCAL_OWNER = "yes";
  env.ASSETS = { fetch: () => fetch(appUrl()) };
  const now = new Date("2026-01-01T12:00:00Z");
  const { file } = checkedMaterial(definition.toString("utf8"));
  const material = { file, text: definition.toString("utf8"), poster: materialPoster(file), credit: "" };
  for (const [index, title] of ["First automaton", "Second automaton"].entries()) {
    await storeMaterialSubmission(submissions, `20260101-12000${index}-1234abcd`, { ...material, title }, now);
  }

  const canvas = { recipe: recipe(), image: PNG, credit: "" };
  for (const [index, title] of ["First canvas", "Second canvas", "Interrupted canvas", "Third canvas", "Fourth canvas"].entries()) {
    const id = `20260101-13000${index}-1234abcd`;
    await storeSubmission(submissions, id, { ...canvas, title }, now);
    if (title === "Interrupted canvas") {
      await approve(submissions, library, id, now, sharpThumbnail);
      // The index is committed, but an interrupted approval left the pending files.
      await storeSubmission(submissions, id, { ...canvas, title }, now);
    }
  }

  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = new Request(new URL(incoming.url, `http://${incoming.headers.host}`), {
        method: incoming.method,
        headers: incoming.headers,
        body: incoming.method === "POST" ? await buffer(incoming) : undefined,
      });
      const response = await worker.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
