import { call } from "../.platform/client";
import { render } from "./main.js";
import { area, el, field, flash, form, input, muted, panel, submit, text } from "./ui.js";

export async function settingsView() {
  const site = await call("get_site", {});
  const theme = el(
    "select",
    { name: "theme", id: "theme" },
    ...[
      ["default", "The built-in theme"],
      ["none", "None: my head, header and footer are the whole page"],
    ].map(([value, label]) => el("option", { value, textContent: label, selected: site.theme === value })),
  );
  return el(
    "div",
    {},
    text("h1", "Settings"),
    panel(
      form(
        [
          field("Site title", input("title", { value: site.title })),
          field("Description", input("description", { value: site.description })),
          field("Head: HTML placed in every themed page's head, such as a stylesheet link", area("head", site.head)),
          field("Header: the path of a template page, or empty for the built-in header", input("header", { value: site.header, placeholder: "/root/chrome/header" })),
          field("Footer: the path of a template page, or empty for the built-in footer", input("footer", { value: site.footer, placeholder: "/root/chrome/footer" })),
          field("Theme", theme),
        ],
        submit("Save", "", { className: "primary" }),
        async (values) => {
          await call("set_site_info", values);
          flash("Saved. It is live on every themed page now.");
          await render();
        },
      ),
    ),
    muted("The chrome is live on every markdown page the moment it is saved, so a broken tag breaks all of them. HTML pages are never wrapped."),
  );
}

// The owner's rules for how the site is written, which every Claude session reads first. The rev
// makes a save refused, not lost, when Claude changed them since this screen was opened.
export async function instructionsView() {
  const current = await call("get_instructions", {});
  return el(
    "div",
    {},
    text("h1", "Instructions"),
    muted(`Every session reads these before it writes anything. Keep them short: ${current.text.length} of ${current.limit} characters.`),
    panel(
      form(
        [field("Instructions", area("text", current.text, { className: "body" }))],
        submit("Save", "", { className: "primary" }),
        async ({ text: value }) => {
          await call("set_instructions", { text: value, ...(current.rev > 0 ? { if_rev: current.rev } : {}) });
          flash("Saved.");
          await render();
        },
      ),
    ),
  );
}
