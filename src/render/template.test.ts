import { testApp } from "@celsoft/platform/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as service from "../pages/service";
import app from "../worker";

// Storage on a Worker is a network read, so every page read here waits as one would there.
const reads = new Map<string, number>();
vi.mock("../pages/service", async (original) => {
  const real = await original<typeof service>();
  return {
    ...real,
    getPage: async (...args: Parameters<typeof real.getPage>) => {
      if (slow) {
        reads.set(args[1], (reads.get(args[1]) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return real.getPage(...args);
    },
  };
});
let slow = false;

let t: Awaited<ReturnType<typeof testApp>>;
let owner: Awaited<ReturnType<typeof t.signUp>>;

beforeEach(async () => {
  slow = false;
  reads.clear();
  t = await testApp(app);
  owner = await t.signUp("owner@example.com");
});
afterEach(() => t.close());

const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;

// sean.celsoft.com's home page: recent renders title once and row for the rest, and row renders title.
const TEMPLATES = {
  "/root/templates/title": "{{ p.title }}",
  "/root/templates/row": '<a class="row" href="{{ p.path }}">{% render "/root/templates/title", p: p, pages: pages %}</a>',
  "/root/templates/recent":
    '{%- assign stream = pages | where: "meta.date" | sort: "meta.date" | reverse -%}' +
    "{%- for p in stream -%}{%- if forloop.first %}" +
    '<b>{% render "/root/templates/title", p: p, pages: pages %}</b>' +
    '{%- else %}{% render "/root/templates/row", p: p, pages: pages %}{%- endif -%}{%- endfor %}',
};

it("renders nested templates within the limit when every read waits, reading each file once", async () => {
  for (const [path, content] of Object.entries(TEMPLATES)) await call("publish_page", { path, content, format: "html" });
  for (let i = 1; i <= 8; i++)
    await call("publish_page", { path: `/essay/e${i}`, content: `# Essay ${i}`, meta: { date: `2026-01-0${i}` } });
  await call("publish_page", { path: "/root", content: '# Home\n\n```pages\n{% render "/root/templates/recent", pages: site.pages %}\n```' });
  slow = true;
  const html = await (await t.fetch("/")).text();
  expect(html).not.toContain("Template error");
  expect(html).toContain('<a class="row" href="/essay/e1">Essay 1</a>');
  for (const path of Object.keys(TEMPLATES)) expect(reads.get(path)).toBe(1);
}, 30000);
