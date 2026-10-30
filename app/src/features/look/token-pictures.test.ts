import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TokenPicture } from "./token-pictures";

vi.mock("../../app/library-session", () => ({
  useLibrary: () => ({ thumbnailUrl: (imageId: number) => `/thumbs/${imageId}.webp` }),
}));

it("shows a neutral tile for an uploaded reference whose picture is unavailable", () => {
  const html = renderToStaticMarkup(createElement(TokenPicture, { point: { source: "upload", code: [1, 2, 3], norm: 4, slot: 5 } }));
  expect(html).toContain("No public picture");
  expect(html).not.toContain("<img");
});

it("shows the visitor's uploaded picture when it is available", () => {
  const html = renderToStaticMarkup(createElement(TokenPicture, { point: { source: "upload", code: [1, 2, 3], norm: 4, slot: 5 }, uploadUrl: "blob:picture" }));
  expect(html).toContain('src="blob:picture"');
  expect(html).not.toContain("No public picture");
});
