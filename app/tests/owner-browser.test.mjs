import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "../../gallery/node_modules/playwright-core/index.mjs";

test("the owner reviews both submission queues and edits a published label on the Automata page", async () => {
  const base = process.env.SHELL_GALLERY_TEST_BASE_URL;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: "chromium-headless-shell" }),
  });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    page.setDefaultTimeout(12_000);
    const redirect = await page.request.get(base + "/admin", { maxRedirects: 0 });
    assert.equal(redirect.status(), 302);
    assert.equal(redirect.headers().location, base + "/admin/automata");
    const document = await page.goto(base + "/admin");
    assert.equal(document.headers()["x-robots-tag"], "noindex");

    await page.getByText(/Canvas review · 5 pending/).click();
    const pending = page.getByRole("region", { name: "Pending canvases" });
    const shown = page.getByRole("region", { name: "Shown canvases" });
    const hidden = page.getByRole("region", { name: "Hidden canvases" });
    const row = (section, title) => section.getByRole("listitem").filter({ hasText: title });
    const action = (section, title, name) => row(section, title).getByRole("button", { name, exact: true }).click();
    await action(pending, "Interrupted canvas", "Finish cleanup");
    await row(pending, "Interrupted canvas").waitFor({ state: "detached" });
    await row(shown, "Interrupted canvas").waitFor();
    await action(pending, "Second canvas", "Reject…");
    await row(pending, "Second canvas").getByText("Permanently reject “Second canvas”?").waitFor();
    await action(pending, "Second canvas", "Cancel");
    await action(pending, "Second canvas", "Reject…");
    await action(pending, "Second canvas", "Reject for good");
    await row(pending, "Second canvas").waitFor({ state: "detached" });
    await action(pending, "First canvas", "Approve");
    await action(shown, "First canvas", "Hide");
    await action(hidden, "First canvas", "Restore");
    await action(shown, "First canvas", "Purge…");
    await action(shown, "First canvas", "Cancel");
    await action(shown, "First canvas", "Purge…");
    await action(shown, "First canvas", "Purge for good");
    await row(shown, "First canvas").waitFor({ state: "detached" });
    await page.getByText(/Clear the cached files/).waitFor();
    await pending.getByRole("button", { name: "Approve all…" }).click();
    await pending.getByText("Publish all 2 pending canvases?").waitFor();
    await pending.getByRole("button", { name: "Cancel" }).click();
    await pending.getByRole("button", { name: "Approve all…" }).click();
    await pending.getByRole("button", { name: "Publish all" }).click();
    await row(shown, "Third canvas").waitFor();
    await row(shown, "Fourth canvas").waitFor();
    assert.equal(await pending.getByRole("listitem").count(), 0);

    await page.getByRole("link", { name: "2 automata await review" }).click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByText(/Approved. It is published in basis group 4009/).waitFor();
    await page.getByText(/Second automaton, by/).waitFor();
    await page.getByRole("button", { name: "Reject…", exact: true }).click();
    await page.getByRole("button", { name: "Reject for good" }).click();
    await page.getByText("Nothing waits for review.").waitFor();
    await page.getByRole("link", { name: "All basis groups" }).click();
    await page.locator('[data-group="4009"] .automata-deck-link').click();
    await page.getByText("Edit title and credit", { exact: true }).click();
    await page.getByRole("textbox", { name: "Automaton title" }).fill("Garden");
    await page.getByRole("textbox", { name: "Credit", exact: true }).fill("Contributor");
    await page.getByRole("button", { name: "Save label" }).click();
    await page.locator(".owner-automaton-label").getByText("Saved", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Edit title and credit", { exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Automaton title" }).inputValue(), "Garden");
    assert.equal(await page.getByRole("textbox", { name: "Credit", exact: true }).inputValue(), "Contributor");
    const lists = await (await page.request.get(base + "/admin/api/materials")).json();
    assert.deepEqual(lists.pending, []);
    assert.deepEqual(lists.published.map(({ title, credit }) => [title, credit]), [["Garden", "Contributor"]]);
    const publicIndex = await (await page.request.get(process.env.GALLERY_WORKER + "/api/materials")).json();
    assert.equal(publicIndex.entries[0].title, "Garden");
    assert.equal(new URL(page.url()).pathname, "/admin/automata");
  } finally {
    await browser.close();
  }
});
