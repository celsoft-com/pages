import { marked } from "marked";
import { highlight } from "./highlight";

marked.setOptions({ gfm: true, breaks: false });
marked.use({ renderer: { code: ({ text, lang }) => highlight(text, lang) } });

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}
