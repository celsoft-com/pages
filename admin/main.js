// The site's admin: a browser app over the same endpoints Claude and the REST API use, routed by
// the address's fragment, such as #/page?path=/about. Signing in, tokens and invitations are the
// platform's own screens; this links to them and never rebuilds them.
import { assetsView } from "./assets.js";
import { collectionView, collectionsView } from "./data.js";
import { moveView, pageView, pagesView } from "./pages.js";
import { instructionsView, settingsView } from "./settings.js";
import { $, attempt, button, el, flash, link, panel, routeOf, text } from "./ui.js";

let session = null;

const VIEWS = {
  "/": pagesView,
  "/page": pageView,
  "/move": moveView,
  "/data": collectionsView,
  "/collection": collectionView,
  "/assets": assetsView,
  "/instructions": instructionsView,
  "/settings": settingsView,
};

const SECTIONS = [
  ["Pages", "#/", ["/", "/page", "/move"]],
  ["Data", "#/data", ["/data", "/collection"]],
  ["Assets", "#/assets", ["/assets"]],
  ["Instructions", "#/instructions", ["/instructions"]],
  ["Settings", "#/settings", ["/settings"]],
];

async function loadSession() {
  const response = await fetch("/api/auth/get-session");
  session = response.ok ? await response.json().catch(() => null) : null;
}

function renderNav(here) {
  const brand = link("Admin", "#/", { className: "brand" });
  if (!session) return $("nav").replaceChildren(brand, el("span", { className: "spacer" }));
  $("nav").replaceChildren(
    brand,
    ...SECTIONS.map(([label, href, paths]) => link(label, href, { className: paths.includes(here) ? "active" : "" })),
    el("span", { className: "spacer" }),
    link("View site", "/"),
    link("Docs", "/docs"),
    link("API tokens", "/tokens"),
    ...(session.user.role === "owner" || session.user.role === "admin" ? [link("Invite people", "/invites")] : []),
    button("Sign out", attempt(signOut), { className: "link" }),
  );
}

async function signOut() {
  await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  session = null;
  await render();
}

function signInScreen() {
  return panel(
    text("h1", "Sign in"),
    el("p", {}, "The admin is the site owner's. ", link("Sign in", `/login?next=${encodeURIComponent("/admin")}`), " to manage the site."),
  );
}

// Everything here needs the owner's access, so anyone else is told so rather than shown screens
// that refuse every action with a 404.
function notOwnerScreen() {
  return panel(
    text("h1", "Not the owner"),
    el("p", {}, `You are signed in as ${session.user.email}, and only the site's owner can manage it. `, link("View the site", "/")),
  );
}

export async function render() {
  const { path, params } = routeOf();
  if (session === null) await loadSession();
  renderNav(path);
  const main = $("main");
  if (!session) return main.replaceChildren(signInScreen());
  if (session.user.role !== "owner") return main.replaceChildren(notOwnerScreen());
  const view = VIEWS[path];
  if (!view) return main.replaceChildren(panel(text("h1", "Not found"), el("p", {}, "Nothing here. ", link("Back to pages", "#/"))));
  try {
    main.replaceChildren(await view(params));
  } catch (error) {
    main.replaceChildren(panel(text("h1", "Something went wrong"), text("p", error.message)));
  }
}

window.addEventListener("hashchange", () => {
  flash("");
  render();
});
render();
