// What every admin view builds with: elements, messages, and the in-place confirmation.

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export const text = (tag, content, props = {}) => el(tag, { textContent: content, ...props });
export const link = (content, href, props = {}) => el("a", { textContent: content, href, ...props });
export const button = (content, onclick, props = {}) => el("button", { type: "button", textContent: content, onclick, ...props });
export const pill = (content, warn = false) => text("span", content, { className: warn ? "pill warn" : "pill" });
export const panel = (...children) => el("div", { className: "panel" }, ...children);
export const muted = (content) => text("p", content, { className: "muted" });

let timer;
export function flash(message, kind = "info") {
  const box = $("flash");
  box.textContent = message;
  box.className = message ? kind : "";
  clearTimeout(timer);
  if (message && kind !== "error") timer = setTimeout(() => flash(""), 6000);
}

// Runs an action from a button or form and shows its refusal instead of failing silently.
export const attempt = (work) => async (...args) => {
  try {
    await work(...args);
  } catch (error) {
    flash(error.message, "error");
  }
};

// The app asks its own questions: no confirm(), no alert(), no dialog the browser draws. A
// destructive button turns into its own confirmation, stated in full, where it was pressed, and a
// second press commits. The question says what will happen, never "are you sure?".
export function confirmInPlace(label, question, work, cancel = "Keep it") {
  const start = button(label, null, { className: "danger" });
  const asking = el(
    "span",
    { className: "confirm", hidden: true },
    text("span", question, { className: "question" }),
    button("Yes", attempt(work), { className: "yes" }),
    button(cancel, () => {
      asking.hidden = true;
      start.hidden = false;
    }),
  );
  start.onclick = () => {
    start.hidden = true;
    asking.hidden = false;
  };
  return el("span", {}, start, asking);
}

// A form whose fields are named inputs; submitting runs work with them as an object.
export function form(children, submit, work, props = {}) {
  const node = el("form", props, ...children, el("div", { className: "row" }, ...[submit].flat()));
  node.addEventListener(
    "submit",
    attempt(async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(node));
      await work(values, event.submitter?.value ?? "", node);
    }),
  );
  return node;
}

export const field = (labelText, control) => el("div", {}, text("label", labelText, { htmlFor: control.name }), control);
export const input = (name, props = {}) => el("input", { name, id: name, ...props });
export const area = (name, value = "", props = {}) => el("textarea", { name, id: name, value, ...props });
export const submit = (content, value = "", props = {}) =>
  el("button", { type: "submit", textContent: content, value, ...props });

export const when = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "never");

// Hash routes carry their arguments as a query, such as #/page?path=/about.
export function routeOf(hash = location.hash) {
  const raw = hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(query) };
}

export const to = (path, params = {}) => {
  const query = new URLSearchParams(params).toString();
  return `#${path}${query ? `?${query}` : ""}`;
};
