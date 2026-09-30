import { sha256Hex } from "../crypto/hmac";
import { normalizePath } from "../pages/path";
import { getPage } from "../pages/service";
import { getSettings } from "../settings";
import type { SiteSettings } from "../types";

// The settings and the two stored templates they name, read together because a themed page is
// all three around its body. A named page that has gone renders as the built-in piece rather than
// failing every page on the site.
export interface Chrome {
  site: SiteSettings;
  header: string;
  footer: string;
  tag: string;
}

async function template(path: string): Promise<string> {
  return path ? ((await getPage(path))?.body ?? "") : "";
}

export async function loadChrome(): Promise<Chrome> {
  const site = await getSettings();
  const [header, footer] = await Promise.all([template(site.header), template(site.footer)]);
  // A themed page's tag has to move when any of this does: taken from the page alone, it would let a
  // browser revalidate a new header into a 304.
  const tag = (await sha256Hex(JSON.stringify([site, header, footer]))).slice(0, 12);
  return { site, header, footer, tag };
}

// A name that points at nothing would silently render the built-in piece on every page, so a path
// is only accepted once a template is stored there.
export async function templatePath(field: "header" | "footer", raw: string): Promise<string> {
  if (raw.trim() === "") return "";
  const path = normalizePath(raw);
  if (!(await getPage(path)))
    throw new Error(
      `No page is stored at ${path} to use as the ${field}. Publish the template there first, as an html page.`,
    );
  return path;
}
