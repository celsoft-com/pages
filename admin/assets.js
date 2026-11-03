import { call } from "../.platform/client";
import { render } from "./main.js";
import { confirmInPlace, el, field, flash, form, input, link, muted, panel, submit, text } from "./ui.js";

const size = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

// Files go up through upload_asset and come back over plain HTTP at their url; nothing here reads
// a file's bytes into the page.
export async function assetsView() {
  const { assets } = await call("list_assets", {});
  const rows = assets.length
    ? assets.map((a) =>
        el(
          "tr",
          {},
          el("td", {}, link(a.path ?? a.filename, a.url, { target: "_blank" }), text("div", a.filename, { className: "small muted" })),
          el("td", { className: "small muted" }, size(a.bytes)),
          el(
            "td",
            { className: "actions" },
            a.path
              ? confirmInPlace("Delete", `Delete ${a.path} for good`, async () => {
                  await call("delete_asset", { path: a.path });
                  flash(`Deleted ${a.path}.`);
                  await render();
                })
              : text("span", "stored by hash", { className: "small muted" }),
          ),
        ),
      )
    : [el("tr", {}, el("td", { colSpan: 3, className: "muted" }, "No files yet."))];

  const upload = form(
    [
      field("File", input("file", { type: "file", required: true })),
      field("Path, which files it under that folder, for example /gallery/photo.jpg", input("path", { placeholder: "/gallery/photo.jpg" })),
    ],
    submit("Upload", "", { className: "primary" }),
    async ({ file, path }) => {
      const stored = await call("upload_asset", { file, ...(path.trim() ? { path: path.trim() } : {}) });
      flash(`Uploaded to ${stored.url}.`);
      await render();
    },
  );

  return el(
    "div",
    {},
    text("h1", "Assets"),
    panel(upload),
    muted("A file in the /root folder named favicon.ico, .svg, .png, .webp or .jpg is the site icon."),
    panel(el("table", {}, el("thead", {}, el("tr", {}, ...["File", "Size", ""].map((h) => text("th", h)))), el("tbody", {}, ...rows))),
  );
}
