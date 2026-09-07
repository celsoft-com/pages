import { describe, expect, it } from "vitest";
import { editorHead } from "./editor";

describe("the page editor's highlighting", () => {
  it("pins an exact version", () => {
    const urls = editorHead.match(/prism-code-editor@[^/"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/@\d+\.\d+\.\d+$/);
  });

  it("hangs off the textarea the editor screen renders", () => {
    expect(editorHead).toContain("textarea[data-editor]");
  });

  // The script is inlined in the admin's own HTML, so a closing tag inside it would end the
  // element around it and the rest would be parsed as markup.
  it("carries no tag that would end the element it sits in", () => {
    expect(editorHead.toLowerCase().split("</script").length).toBe(2);
    expect(editorHead.toLowerCase().split("</style").length).toBe(2);
  });

  it("takes its colours from the admin palette rather than a vendored theme", () => {
    expect(editorHead).toContain("--pce-bg: var(--bg)");
    expect(editorHead).not.toContain("themes/");
  });
});
