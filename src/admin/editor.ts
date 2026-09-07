// Syntax highlighting in the page editor is prism-code-editor, pinned to an exact version on
// jsDelivr. The admin has no client build step and nothing here is worth adding one for: if the
// CDN is unreachable the field is the plain textarea the server rendered, which is what it was.
const CDN = "https://cdn.jsdelivr.net/npm/prism-code-editor@5.4.0/dist";

// The editor takes the palette the rest of the admin already has, so it follows the light and dark
// schemes with it. A vendored theme file would be one fixed scheme in a screen that has two.
const THEME = `
.prism-code-editor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875rem;
  line-height: 1.55; padding: .3rem 0; border: 1px solid var(--rule); border-radius: 7px;
  min-height: 22rem; max-height: 80vh; resize: vertical; color: var(--fg);
  --pce-bg: var(--bg); --pce-cursor: var(--fg);
  --pce-selection: color-mix(in srgb, var(--accent) 30%, transparent);
  --pce-bg-highlight: color-mix(in srgb, var(--fg) 4%, transparent); }
.prism-code-editor:focus-within { border-color: var(--accent); }
.token.punctuation, .token.attr-equals, .token.operator { color: var(--muted); }
.token.tag, .token.doctype-tag, .token.title, .token.list { color: var(--accent); }
.token.attr-name, .token.url > .content, .token.code-snippet { color: var(--warn); }
.token.attr-value, .token.string, .token.url-link, .token.url > .url { color: var(--ok); }
.token.entity, .token.blockquote { color: var(--bad); }
.token.comment, .token.prolog, .token.cdata { color: var(--muted); font-style: italic; }
.token.bold, .token.important { font-weight: 700; }
.token.italic { font-style: italic; }
.token.strike { text-decoration: line-through; }
.active-tagname { box-shadow: inset 0 0 0 9in color-mix(in srgb, var(--accent) 18%, transparent); }`;

// The editor replaces the textarea it is given, which takes the attributes with it, so the name
// and id are read first and put back: without a name the form would post no content at all.
const SCRIPT = `
const CDN = ${JSON.stringify(CDN)};
const [{ editorFromPlaceholder }, { defaultCommands, editHistory }, { matchTags }] = await Promise.all([
  import(CDN + "/index.js"),
  import(CDN + "/extensions/commands/index.js"),
  import(CDN + "/extensions/matchTags.js"),
  import(CDN + "/languages/html.js"),
  import(CDN + "/prism/languages/markdown.js"),
]);

const placeholder = document.querySelector("textarea[data-editor]");
const format = document.getElementById("format");
const { id, name, value } = placeholder;
const language = () => (format.value === "html" ? "html" : "markdown");

const editor = editorFromPlaceholder(
  placeholder,
  { language: language(), value, wordWrap: true, lineNumbers: false, tabSize: 2 },
  defaultCommands(),
  editHistory(),
  matchTags(),
);

Object.assign(editor.textarea, { id, name, required: true });
format.addEventListener("change", () => editor.setOptions({ language: language() }));`;

export const editorHead = `<link rel="stylesheet" href="${CDN}/layout.css">
<style>${THEME}</style>
<script type="module">${SCRIPT}</script>`;
