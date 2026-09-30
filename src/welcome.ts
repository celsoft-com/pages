import { layout } from "./render/theme";
import { DEFAULT_SETTINGS } from "./settings";

export function welcomePage(): Response {
  return new Response(
    layout({
      title: "A new site",
      chrome: { site: { ...DEFAULT_SETTINGS, title: "A new site" }, header: "", footer: "" },
      content: `
<h1>This site is ready to set up</h1>
<p>It is a personal page host. Once it is set up, its owner writes and publishes pages here by talking to Claude.</p>
<p>Nothing has been published yet.</p>
<p style="margin-top:2rem"><a href="/admin/setup">Set up this site</a></p>`,
    }),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
