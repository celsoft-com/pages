import { createCssVariablesTheme, createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import c from "shiki/langs/c.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import docker from "shiki/langs/docker.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import ini from "shiki/langs/ini.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import xml from "shiki/langs/xml.mjs";
import yaml from "shiki/langs/yaml.mjs";

// Colours are CSS variables, never a palette: the built-in theme defines them for its light and dark
// schemes, and a site with its own stylesheet defines its own, so no theme file enters the platform.
// The JavaScript regex engine keeps this synchronous and free of the wasm Oniguruma build.
const THEME = createCssVariablesTheme({ name: "css-variables", variablePrefix: "--shiki-", fontStyle: true });

// A fixed, common set. A language outside it renders as a plain code block exactly as marked would,
// which is also what keeps a fence meant for a script on the page (mermaid, say) untouched.
const LANGUAGES = [c, css, diff, docker, go, html, ini, javascript, json, markdown, python, rust, shellscript, sql, toml, tsx, typescript, xml, yaml];

let highlighter: HighlighterCore | null = null;

// Built on first use, so a request that renders no code pays nothing for the grammars.
function get(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({ themes: [THEME], langs: LANGUAGES, engine: createJavaScriptRegexEngine() });
  return highlighter;
}

export function highlight(code: string, info: string | undefined): string | false {
  const lang = (info ?? "").trim().split(/\s+/)[0].toLowerCase();
  if (!lang || !get().getLoadedLanguages().includes(lang)) return false;
  return get().codeToHtml(code, {
    lang,
    theme: THEME.name!,
    // The class marked would have given the code element, so a script or stylesheet selecting on it
    // finds the block whether or not it was highlighted.
    transformers: [{ code: (node) => void (node.properties.class = `language-${lang}`) }],
  });
}

// The built-in schemes' token colours, for the themed layout and the docs. Both already declare
// color-scheme light dark, so light-dark picks the hue and one rule serves both schemes.
export const TOKEN_STYLES = `
:root {
  --shiki-foreground: var(--fg);
  --shiki-background: var(--code-bg);
  --shiki-token-comment: var(--muted);
  --shiki-token-punctuation: var(--muted);
  --shiki-token-keyword: light-dark(#a0306e, #f08bc0);
  --shiki-token-constant: light-dark(#1f5fa8, #8cc2ff);
  --shiki-token-function: light-dark(#6b3fb0, #c3a6ff);
  --shiki-token-string: light-dark(#2d7a35, #8fd694);
  --shiki-token-string-expression: light-dark(#2d7a35, #8fd694);
  --shiki-token-parameter: light-dark(#8a5a00, #e6b86a);
  --shiki-token-link: var(--accent);
  --shiki-token-inserted: light-dark(#2d7a35, #8fd694);
  --shiki-token-deleted: light-dark(#b3261e, #ff8f87);
}`;
