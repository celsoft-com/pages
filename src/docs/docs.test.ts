import { readFileSync, readdirSync } from "node:fs";
import { testApp } from "@celsoft/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../worker";
import { LICENSE_MD, README_MD, TOPIC_SOURCES } from "./content";
import { linkToPage, REPOSITORY, topics } from "./topics";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(app);
});
afterAll(() => t.close());

const PAGES = ["/docs", "/docs/license", ...topics().map((topic) => `/docs/${topic.slug}`)];

describe("the generated content", () => {
  it("is the README, the licence and every topic as they are on disk", () => {
    expect(README_MD).toBe(readFileSync("README.md", "utf8"));
    expect(LICENSE_MD).toBe(readFileSync("LICENSE.md", "utf8"));
    const files = readdirSync("docs").filter((file) => file.endsWith(".md")).sort();
    expect(TOPIC_SOURCES.map((topic) => `${topic.slug}.md`)).toEqual(files);
    for (const topic of TOPIC_SOURCES) expect(topic.source).toBe(readFileSync(`docs/${topic.slug}.md`, "utf8"));
  });

  it("gives every topic a title and an order", () => {
    for (const topic of topics()) {
      expect(topic.title, topic.slug).not.toBe(topic.slug);
      expect(topic.order, topic.slug).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });
});

describe("/docs", () => {
  it("serves the README as the overview, signed out", async () => {
    const response = await t.fetch("/docs");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("A website you build by talking to Claude.");
    expect(html).toContain('href="/docs/privacy"');
    expect(html).toContain('href="/docs/license"');
    expect(html).toContain(`href="${REPOSITORY}/AGENTS.md"`);
  });

  it("serves every topic under its file name, with every page in the sidebar", async () => {
    for (const path of PAGES) {
      const response = await t.fetch(path);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      for (const href of PAGES) expect(html, path).toContain(`href="${href}"`);
    }
  });

  it("links only to pages that exist", async () => {
    for (const path of PAGES) {
      const html = await (await t.fetch(path)).text();
      const links = [...html.matchAll(/href="(\/docs[^"#]*)/g)].map((match) => match[1]);
      for (const link of new Set(links)) expect((await t.fetch(link)).status, `${path} -> ${link}`).toBe(200);
    }
  });

  it("says which deploy is serving it", async () => {
    expect(await (await t.fetch("/docs")).text()).toContain("Running as test, not from a deploy.");
  });

  it("answers 404 for a topic that does not exist", async () => {
    expect((await t.fetch("/docs/nowhere")).status).toBe(404);
  });
});

describe("linkToPage", () => {
  it("turns topic files into pages and anything else into a link to the repository", () => {
    expect(linkToPage("[a](bundles.md#x) [b](docs/privacy.md) [c](LICENSE.md) [d](README.md)")).toBe(
      "[a](/docs/bundles#x) [b](/docs/privacy) [c](/docs/license) [d](/docs)",
    );
    expect(linkToPage("[e](AGENTS.md) [f](platform.jsonc) [g](docs)")).toBe(
      `[e](${REPOSITORY}/AGENTS.md) [f](${REPOSITORY}/platform.jsonc) [g](/docs)`,
    );
    expect(linkToPage("[h](https://example.com) [i](/p/about) [j](#top)")).toBe(
      "[h](https://example.com) [i](/p/about) [j](#top)",
    );
  });
});
