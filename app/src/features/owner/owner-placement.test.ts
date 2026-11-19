import { describe, expect, it } from "vitest";
import { ownerPlacement } from "./owner-placement";

describe("where the owner's view runs", () => {
  const at = (documentPath: string, routePath = documentPath, framed = false, search = "") => ownerPlacement({ framed, documentPath, routePath, search });

  it("runs in the document the Worker served for the owner's path, and on its basis panels", () => {
    expect(at("/admin/automata")).toEqual({ kind: "run" });
    expect(at("/admin/automata/basis/7178")).toEqual({ kind: "run" });
    expect(at("/admin/automata", "/admin/automata/basis/7178")).toEqual({ kind: "run" });
  });

  it("refuses inside another page's frame, whatever the path", () => {
    expect(at("/admin/automata", "/admin/automata", true)).toEqual({ kind: "framed" });
    expect(at("/ADMIN/automata", "/ADMIN/automata", true)).toEqual({ kind: "framed" });
  });

  it("reloads at the canonical path a document served for another spelling, keeping the query", () => {
    expect(at("/ADMIN/automata", "/ADMIN/automata", false, "?group=pending&material=20261118-221005-8afe5fcd"))
      .toEqual({ kind: "reload", to: "/admin/automata?group=pending&material=20261118-221005-8afe5fcd" });
    expect(at("/%61dmin/automata")).toEqual({ kind: "reload", to: "/admin/automata" });
    expect(at("/admin%2Fautomata")).toEqual({ kind: "reload", to: "/admin/automata" });
    expect(at("/Admin/Automata/basis/12")).toEqual({ kind: "reload", to: "/admin/automata/basis/12" });
  });

  it("reloads a view that a client navigation brought into a document served for another page", () => {
    // /ADMIN/materials is answered by the static assets; the app's earlier-page route then navigates to /admin/automata.
    expect(at("/ADMIN/materials/x", "/admin/automata")).toEqual({ kind: "reload", to: "/admin/automata" });
    expect(at("/index", "/admin/automata", false, "?group=7178")).toEqual({ kind: "reload", to: "/admin/automata?group=7178" });
    expect(at("/%E0%A4", "/%E0%A4")).toEqual({ kind: "reload", to: "/admin/automata" });
  });
});
