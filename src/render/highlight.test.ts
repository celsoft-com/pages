import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

const block = (lang: string, code: string) => renderMarkdown("```" + lang + "\n" + code + "\n```");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("code blocks", () => {
  it("are highlighted with CSS variables, never colours", () => {
    const html = block("ts", "const x: number = 1;");
    expect(html).toContain('class="shiki css-variables"');
    expect(html).toContain("var(--shiki-token-keyword)");
    expect(html).not.toMatch(/color:#/);
  });

  it("keep the class marked would have given them, and their text exactly", () => {
    const code = 'if (a < b && c > "d") {}';
    const html = block("typescript", code);
    expect(html).toContain('<code class="language-typescript">');
    expect(text(html).trim()).toBe(code);
  });

  it("take the first word of the info string as the language", () => {
    expect(block("python title=x", "print(1)")).toContain('class="language-python"');
  });

  // A fence a page's own script mounts, mermaid say, has to arrive as marked wrote it.
  it("leave a language outside the set as marked renders it", () => {
    expect(block("mermaid", "graph TD; A-->B")).toBe('<pre><code class="language-mermaid">graph TD; A--&gt;B\n</code></pre>\n');
  });

  it("leave a block with no language alone", () => {
    expect(block("", "<b>")).toBe("<pre><code>&lt;b&gt;\n</code></pre>\n");
  });
});
