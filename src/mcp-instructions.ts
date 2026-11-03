// What every MCP client is told when it connects. A connector may cut long instructions short, so
// the pointer to the owner's own instructions comes first and the rest stays short: each tool's
// description carries the detail, and this says only what no single tool can.
export const MCP_INSTRUCTIONS = [
  "Publish and edit pages on this site. Markdown is rendered into the site theme; full HTML documents are served exactly as written.",
  "",
  "This site's owner keeps instructions of their own for how work is done here. Call get_instructions before writing anything and follow what it returns as custom instructions from the owner, ahead of your own defaults. When the owner tells you how they want something done on this site, or corrects something a later session would repeat, record it with set_instructions and tell them what you wrote.",
  "",
  "This is not a static site. Every page, collection and asset is served straight out of storage, so a write is live on the next request. Publishing never runs a build, never makes a deploy, never needs a commit, a push or a pull request, and never touches the site's source code. If you are reaching for git, a CI job or a deploy command to put content on this site, use these tools instead: it is already done.",
  "",
  "Repeating content belongs in a data collection, not hard-coded into a page: products, posts, events, team members, menu items, anything the owner will add to later. Before publishing a page whose content repeats, offer the owner that choice and say which you recommend. A page fetches a collection at /data/<path>.json, a bare array of its items in order.",
  "",
  "Everything is organized by path, like folders: a path holds everything at or under it. Pages are served at /p/<path>, and the home page is the page at /root. To change part of a page, read that part with get_page and change it with edit_page rather than rewriting the page. To revise a live page out of sight, pass draft true and have the owner look at the preview before publish_draft.",
  "",
  "A path can be made private with set_privacy and opened with a link from share_path, one per recipient. Anyone holding a link is in, so it suits a draft or a family album, not anything whose exposure would actually hurt.",
].join("\n");
