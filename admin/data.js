import { call } from "../.platform/client";
import { render } from "./main.js";
import { area, confirmInPlace, el, field, flash, form, input, link, muted, panel, submit, text, to } from "./ui.js";

const start = () =>
  form([field("New collection path", input("path", { required: true, placeholder: "/products" }))], submit("Open"), ({ path }) => {
    location.hash = to("/collection", { path: path.trim() });
  });

export async function collectionsView() {
  const { collections } = await call("list_collections", {});
  const rows = collections.length
    ? collections.map((c) =>
        el(
          "tr",
          {},
          el("td", {}, link(c.path, to("/collection", { path: c.path })), text("div", c.url, { className: "small muted mono" })),
          el("td", {}, String(c.items)),
          el("td", { className: "small muted mono" }, Object.entries(c.refs).map(([f, target]) => `${f} → ${target}`).join(", ")),
          el(
            "td",
            { className: "actions" },
            confirmInPlace("Delete", `Delete ${c.path} and its ${c.items} item${c.items === 1 ? "" : "s"}`, async () => {
              await call("delete_collection", { path: c.path, if_rev: c.rev });
              flash(`Deleted ${c.path}.`);
              await render();
            }),
          ),
        ),
      )
    : [el("tr", {}, el("td", { colSpan: 4, className: "muted" }, "No collections yet. Writing an item creates one."))];
  return el(
    "div",
    {},
    text("h1", "Data"),
    muted("Each collection is served as a bare JSON array at its url, for pages to fetch."),
    panel(el("table", {}, el("thead", {}, el("tr", {}, ...["Collection", "Items", "References", ""].map((h) => text("th", h)))), el("tbody", {}, ...rows))),
    panel(start()),
  );
}

const pretty = (value) => JSON.stringify(value, null, 2);

function parseFields(raw) {
  let fields;
  try {
    fields = JSON.parse(raw);
  } catch {
    throw new Error("The fields are not valid JSON.");
  }
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) throw new Error("The fields must be a JSON object.");
  delete fields.id;
  return fields;
}

// One item at a time, as every data tool works: an item's fields as JSON, written back whole with the
// rev it was read at, so a stale screen is refused rather than overwriting someone else's change.
export async function collectionView(params) {
  const path = params.get("path");
  // A collection exists once its first item is written, so a new path is an empty list to add to.
  const listed = await call("list_items", { path, limit: 200 }).catch((error) => {
    if (error.status === 400 && /No collection exists/.test(error.message))
      return { total: 0, items: [], url: `/data${path}.json` };
    throw error;
  });

  const itemRow = ({ id, rev, item }) => {
    const { id: _, ...fields } = item;
    return el(
      "details",
      { className: "panel" },
      el("summary", {}, text("span", id, { className: "mono" }), text("span", ` · rev ${rev}`, { className: "small muted" })),
      form(
        [field("Fields", area("fields", pretty(fields)))],
        [
          submit("Save", "", { className: "primary" }),
          confirmInPlace("Delete", `Delete ${id} from ${path}`, async () => {
            const result = await call("delete_item", { path, id, if_rev: rev });
            flash(result.orphaned?.length ? `Deleted ${id}; ${result.orphaned.length} records elsewhere still point at it.` : `Deleted ${id}.`);
            await render();
          }),
        ],
        async ({ fields: raw }) => {
          await call("put_item", { path, id, fields: parseFields(raw), merge: false, if_rev: rev });
          flash(`Saved ${id}.`);
          await render();
        },
      ),
    );
  };

  const add = form(
    [field("Id, or leave it empty for one to be made", input("id")), field("Fields", area("fields", "{\n  \n}"))],
    submit("Add item"),
    async ({ id, fields: raw }) => {
      const made = await call("put_item", { path, ...(id.trim() ? { id: id.trim() } : {}), fields: parseFields(raw) });
      flash(`Added ${made.id}.`);
      await render();
    },
  );

  return el(
    "div",
    {},
    text("h1", path),
    el("p", { className: "muted" }, `${listed.total} item${listed.total === 1 ? "" : "s"}, served at `, link(listed.url, listed.url, { target: "_blank" })),
    listed.total > listed.items.length ? muted(`Showing the first ${listed.items.length}.`) : null,
    ...listed.items.map(itemRow),
    text("h2", "New item"),
    panel(add),
    el("p", {}, link("All collections", to("/data"))),
  );
}
