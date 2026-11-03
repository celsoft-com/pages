import { call } from "../.platform/client";
import { render } from "./main.js";
import {
  area,
  attempt,
  button,
  confirmInPlace,
  el,
  field,
  flash,
  form,
  input,
  link,
  muted,
  panel,
  pill,
  submit,
  text,
  to,
  when,
} from "./ui.js";

const ROOT = "/root";

// The private path closing this one, its own scope first, matched on whole segments.
function scopeOf(privates, path) {
  const within = (scope) => path === scope || path.startsWith(`${scope}/`);
  return privates.find((entry) => within(entry.path)) ?? null;
}

// Privacy is a property of a page's path, so it is a column of the page's row: what the state is,
// and one text action. The controls live in the page's own editor, beside its content.
function accessCell(path, privates) {
  const scope = scopeOf(privates, path);
  if (!scope) return el("div", { className: "row" }, pill("Public"));
  if (scope.path !== path)
    return el("div", {}, pill("Private", true), text("div", `via ${scope.path}`, { className: "small muted mono" }));
  const count = scope.shares.length;
  return el(
    "div",
    {},
    el("div", { className: "row" }, pill("Private", true), link(count === 0 ? "Add a link" : `${count} link${count === 1 ? "" : "s"}`, to("/page", { path }) + "#access")),
    text("div", count === 0 ? "Nobody but you can reach it." : scope.shares.map((s) => s.label).join(", "), { className: "small muted" }),
  );
}

export async function pagesView() {
  const [{ pages }, { private: privates }] = await Promise.all([call("list_pages", {}), call("list_shares", {})]);
  const home = pages.find((p) => p.path === ROOT);
  const rest = pages.filter((p) => p.path !== ROOT && p.path !== "/");

  const remove = (path, question) =>
    confirmInPlace("Delete", question, async () => {
      await call("delete_page", { path });
      flash(`Deleted ${path}.`);
      await render();
    });

  // The home page is the page at /root, or the generated contents while there is none; either way it
  // is the row a visitor reaches at /, so it leads the table.
  const homeRow = home
    ? el(
        "tr",
        {},
        el("td", {}, link(home.title, to("/page", { path: ROOT })), text("div", "/ · your home page, stored at /root", { className: "small muted mono" })),
        el("td", {}, pill(home.format), home.has_draft ? pill("draft", true) : null),
        el("td", {}, accessCell(ROOT, privates)),
        el("td", { className: "actions" }, link("View", "/", { className: "button", target: "_blank" }), " ", remove(ROOT, "Delete the home page and list every page at / again")),
      )
    : el(
        "tr",
        {},
        el("td", {}, "Contents", text("div", "Every public page, listed automatically. ", { className: "small muted" }, link("Write a home page", to("/page", { path: ROOT })))),
        el("td", {}, pill("generated")),
        el("td", {}, accessCell(ROOT, privates)),
        el("td", { className: "actions" }, link("View", "/", { className: "button", target: "_blank" })),
      );

  const rows = rest.length
    ? rest.map((p) =>
        el(
          "tr",
          {},
          el("td", {}, link(p.title, to("/page", { path: p.path })), text("div", p.path, { className: "small muted mono" })),
          el("td", {}, pill(p.format), p.has_draft ? [" ", pill("draft", true)] : null),
          el("td", {}, accessCell(p.path, privates)),
          el("td", { className: "actions" }, link("View", p.url, { className: "button", target: "_blank" }), " ", remove(p.path, `Delete ${p.path} for good`)),
        ),
      )
    : [el("tr", {}, el("td", { colSpan: 4, className: "muted" }, "Nothing published yet."))];

  // A private path with no page of its own still has to be reachable here, or only Claude could reopen it.
  const orphans = privates.filter((scope) => !pages.some((p) => p.path === scope.path));

  return el(
    "div",
    {},
    el("div", { className: "row spread" }, text("h1", "Pages"), link("New page", to("/page"), { className: "button" })),
    panel(
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, ...["Page", "Format", "Access", ""].map((h) => text("th", h)))),
        el("tbody", {}, homeRow, ...rows),
      ),
    ),
    orphans.length
      ? [
          text("h2", "Private paths with no page"),
          panel(
            el(
              "table",
              {},
              el("tbody", {}, ...orphans.map((scope) => el("tr", {}, el("td", { className: "mono" }, scope.path), el("td", {}, accessCell(scope.path, privates))))),
            ),
          ),
        ]
      : null,
  );
}

const metaText = (meta) =>
  Object.entries(meta ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");

function parseMeta(raw) {
  const meta = {};
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at === -1) throw new Error(`Meta lines are name: value, and "${line.trim()}" has no colon.`);
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return meta;
}

// Changing one fact sends one name: what was removed goes as null, so nothing else is resent.
function metaChanges(before, after) {
  const changes = { ...after };
  for (const name of Object.keys(before ?? {})) if (!(name in after)) changes[name] = null;
  return changes;
}

// Everything about a path's access in one panel: open or closed, its links, and minting one. A new
// link is shown here once, because only its hash is kept.
async function accessPanel(path) {
  const listed = await call("list_shares", { path });
  // The panel redraws itself in place, so revoking or minting keeps the editor's unsaved text.
  let node;
  const redraw = async (minted) => {
    const next = await accessPanel(path);
    if (minted) next.append(minted);
    node.replaceWith(next);
  };

  if (listed.closed_by)
    return panel(
      el("span", { id: "access" }),
      text("h2", "Access"),
      el("p", {}, "Private, because ", link(listed.closed_by, to("/page", { path: listed.closed_by })), " is. Its links open this page too."),
    );

  const scope = listed.private[0];
  if (!scope)
    return panel(
      el("span", { id: "access" }),
      text("h2", "Access"),
      el(
        "div",
        { className: "row" },
        pill("Public"),
        button(
          "Make private",
          attempt(async () => {
            await call("set_privacy", { path, private: true });
            flash(`${path} is private. Nobody but you can reach it until you add a link.`);
            await render();
          }),
        ),
      ),
      muted("Closing a path closes everything at or under it: its pages, its collections and its files."),
    );

  const shares = scope.shares.length
    ? el(
        "table",
        {},
        el("thead", {}, el("tr", {}, text("th", "Link for"), text("th", "Made"), text("th", ""))),
        el(
          "tbody",
          {},
          ...scope.shares.map((share) =>
            el(
              "tr",
              {},
              el("td", {}, share.label),
              el("td", { className: "small muted" }, when(share.created)),
              el(
                "td",
                { className: "actions" },
                confirmInPlace("Revoke", `End ${share.label}'s link`, async () => {
                  await call("revoke_share", { path, label: share.label });
                  flash(`${share.label}'s link no longer opens ${path}.`);
                  await redraw();
                }),
              ),
            ),
          ),
        ),
      )
    : muted("No links yet, so nobody but you can reach it.");

  const mint = form(
    [field("Who is this link for?", input("label", { required: true, maxLength: 100, placeholder: "Dana" }))],
    submit("Make a link"),
    async ({ label }) => {
      const made = await call("share_path", { path, label: label.trim() });
      await redraw(
        panel(
          text("p", `The link for ${made.label}. It is shown once: copy it now, all of it, including the part after #.`),
          text("div", made.link, { className: "secret mono" }),
        ),
      );
    },
  );

  node = panel(
    el("span", { id: "access" }),
    text("h2", "Access"),
    el(
      "div",
      { className: "row" },
      pill("Private", true),
      confirmInPlace(
        "Make public",
        scope.shares.length === 0
          ? `Reopen ${path} to everyone`
          : `Reopen ${path} to everyone and end ${scope.shares.length === 1 ? "its link" : `all ${scope.shares.length} of its links`}`,
        async () => {
          await call("set_privacy", { path, private: false });
          flash(`${path} is public again.`);
          await render();
        },
        "Keep it private",
      ),
    ),
    shares,
    mint,
  );
  return node;
}

export async function pageView(params) {
  const path = params.get("path");
  if (!path) return newPageView();

  const live = await call("get_page", { path }).catch((error) => (error.status === 404 || error.status === 400 ? null : Promise.reject(error)));
  if (!live) return newPageView(path);
  const working = live.has_draft ? await call("get_page", { path, draft: true }) : live;

  const editor = form(
    [
      field("Title", input("title", { value: working.title })),
      field("Content", area("content", working.content, { className: "body" })),
      field("Meta, one name: value per line", area("meta", metaText(working.meta))),
    ],
    [
      submit("Publish", "publish", { className: "primary" }),
      submit("Save as draft", "draft"),
      live.has_draft ? link("Preview the draft", `/preview${path === ROOT ? "/root" : path}`, { className: "button", target: "_blank" }) : null,
    ],
    async ({ title, content, meta }, action) => {
      const changes = { path, title, content, meta: metaChanges(working.meta, parseMeta(meta)) };
      if (action === "draft") {
        await call("update_page", { ...changes, draft: true });
        flash("Draft saved. Readers still see the live page.");
      } else if (live.has_draft) {
        await call("update_page", { ...changes, draft: true });
        await call("publish_draft", { path });
        flash("Published.");
      } else {
        await call("update_page", changes);
        flash("Published.");
      }
      await render();
    },
  );

  const draftBar = live.has_draft
    ? panel(
        el(
          "div",
          { className: "row spread" },
          text("span", "This page has a draft. The editor shows it; readers see the live page."),
          el(
            "span",
            { className: "row" },
            button(
              "Publish draft",
              attempt(async () => {
                await call("publish_draft", { path });
                flash("Draft published.");
                await render();
              }),
            ),
            confirmInPlace("Discard draft", "Throw the draft away and keep the live page", async () => {
              await call("discard_draft", { path });
              flash("Draft discarded.");
              await render();
            }),
          ),
        ),
      )
    : null;

  return el(
    "div",
    {},
    el(
      "div",
      { className: "row spread" },
      text("h1", live.title),
      el(
        "span",
        { className: "row" },
        link("View", path === ROOT ? "/" : `/p${path}`, { className: "button", target: "_blank" }),
        link("Move", to("/move", { path }), { className: "button" }),
      ),
    ),
    // The path is shown, never edited here: retyping it would write a new page and strand everything
    // filed under the old one. Moving is its own screen, which says what a move leaves behind.
    el("p", { className: "muted" }, text("span", path, { className: "mono" }), ` · ${live.format}`),
    draftBar,
    panel(editor),
    await accessPanel(path),
  );
}

function newPageView(path = "") {
  return el(
    "div",
    {},
    text("h1", "New page"),
    panel(
      form(
        [
          field("Path", input("path", { value: path, required: true, placeholder: "/about" })),
          field("Title, or leave it to the first heading", input("title")),
          field("Content: markdown, or a whole HTML document", area("content", "", { className: "body", required: true })),
          field("Meta, one name: value per line", area("meta")),
        ],
        submit("Publish", "", { className: "primary" }),
        async ({ path: raw, title, content, meta }) => {
          const made = await call("publish_page", {
            path: raw,
            content,
            ...(title.trim() ? { title: title.trim() } : {}),
            meta: parseMeta(meta),
          });
          flash(`Published at ${made.path}.`);
          location.hash = to("/page", { path: made.path });
        },
      ),
    ),
  );
}

function transferReport(result) {
  const list = (items, show) => (items?.length ? el("ul", {}, ...items.map((item) => text("li", show(item)))) : null);
  return panel(
    text("h2", result.applied ? "Done" : "What this would move"),
    list(result.resources, (r) => `${r.kind} ${r.from}${r.to ? ` → ${r.to}` : ""}`),
    result.pages_to_update?.length
      ? [text("h2", "Pages still naming the old path"), list(result.pages_to_update, (p) => `${p.path}, line ${p.lines.map((l) => l.line).join(", ")}${p.more ? ` and ${p.more} more` : ""}`)]
      : null,
    result.privacy_changes?.length ? [text("h2", "Access that changed"), list(result.privacy_changes, (c) => `${c.path}: ${c.was} → ${c.now}`)] : null,
    result.rest_of_bundle?.length ? [text("h2", "Left where it was"), list(result.rest_of_bundle, (r) => `${r.kind} ${r.path}`)] : null,
    list(result.notes, (note) => note),
  );
}

// The whole bundle comes first and the page alone second, because moving the page alone is the
// choice that leaves things behind, and it says what. Both run the same server-side transfer.
export async function moveView(params) {
  const path = params.get("path");
  const report = el("div");
  const move = form(
    [
      field("Move to", input("to", { required: true, value: path })),
      el(
        "div",
        {},
        el("label", {}, el("input", { type: "radio", name: "scope", value: "bundle", checked: true }), ` ${path} and everything under it`),
        el("label", {}, el("input", { type: "radio", name: "scope", value: "page" }), " The page alone"),
      ),
    ],
    [submit("Show what moves", "plan"), submit("Move", "move", { className: "primary" })],
    async ({ to: target, scope }, action) => {
      const args = { from: path, to: target };
      const result =
        scope === "page"
          ? action === "plan"
            ? await call("list_bundle", { path }).then((b) => ({
                applied: false,
                resources: [{ kind: "page", from: path, to: target }],
                rest_of_bundle: [...b.pages.filter((p) => p.path !== path), ...b.collections, ...b.assets].map((r) => ({ kind: r.items !== undefined ? "collection" : r.bytes !== undefined ? "asset" : "page", path: r.path })),
                notes: ["Nothing was changed."],
              }))
            : await call("move_page", args)
          : await call("move_bundle", { ...args, confirm: action === "move" });
      report.replaceChildren(transferReport(result));
      if (result.applied) flash(`Moved to ${target}.`);
    },
  );
  return el("div", {}, text("h1", `Move ${path}`), panel(move), report, el("p", {}, link(`Back to ${path}`, to("/page", { path }))));
}
