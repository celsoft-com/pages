import { normalizePath } from "../pages/path";
import { getPage } from "../pages/service";
import { getSettings } from "../settings";
import type { Page, SiteSettings } from "../types";
import { renderTemplate, type TemplateContext } from "./template";

// The settings and the two stored templates they name, rendered for the page they will wrap. A
// named page that has gone renders as the built-in piece rather than failing every page on the site.
export interface Chrome {
  site: SiteSettings;
  header: string;
  footer: string;
}

async function template(path: string, context: TemplateContext): Promise<string> {
  const stored = path ? await getPage(path) : null;
  return stored ? renderTemplate(stored.body, context) : "";
}

export async function loadChrome(input: TemplateContext["input"]): Promise<{ chrome: Chrome; context: TemplateContext }> {
  const site = await getSettings();
  const context = { input, site: { title: site.title, description: site.description } };
  const [header, footer] = await Promise.all([template(site.header, context), template(site.footer, context)]);
  return { chrome: { site, header, footer }, context };
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
