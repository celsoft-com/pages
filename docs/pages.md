---
title: Pages
order: 30
---

# Pages

A page is a path and a body. The body is markdown or a whole HTML document, it is stored exactly as
written, and the next request serves it. Nothing is compiled, and there is no template to fill in.

## Markdown is themed, HTML is verbatim

Write markdown and the site wraps it in its own theme: the site title and description at the top,
the content below, a light and a dark scheme, and nothing else. There is no navigation bar, because
a site's links are its owner's business: a page that wants to link elsewhere says so in its own
words.

The wrapping is yours to replace. The site's chrome is a head, where your stylesheet link goes, and
a header and a footer, each of which is a [template](templates.md): an ordinary html page holding a
fragment, at a path such as `/root/chrome/header`, named in the settings and edited like any other
page. It sees the page it wraps, so a nav can mark where the reader is. Leave
the header or footer empty to keep the built-in one, or set the theme to none to drop the built-in
styles and chrome altogether, so the page is your head, your header, the content and your footer.
A nav on every page goes in the header template. Chrome is live on every markdown page the moment
it is saved, so a broken tag in it breaks all of them at once. It is set in the admin under
Settings, or by asking Claude. Moving a template page does not update the name, and a name
pointing at nothing falls back to the built-in piece.

Write a full HTML document, starting `<!doctype html>` or `<html>`, and it is served byte for byte.
Your own CSS, your own scripts, a library from a CDN, a map, a canvas, whatever you like. The site
adds nothing to it and takes nothing out, which is also why it cannot give it a favicon tag or a
theme toggle: a verbatim document is verbatim.

A code block in markdown that names its language is highlighted as the page is served, so a reader
needs no script for it. The common languages are covered: TypeScript, JavaScript, TSX, JSON, YAML,
TOML, Python, shell, HTML, CSS, Markdown, diff, SQL, C, Rust, Go, XML, INI and Dockerfile. The
colours are CSS variables such as `--shiki-token-keyword`, which the built-in theme sets for light
and dark and a site with its own stylesheet sets for itself. A block in any other language is left
exactly as written, which is how a diagram or a script meant for the page itself still arrives
intact.

Which one you get is detected from the content unless you say. Ask Claude for "a plain page" and you
will get markdown; ask for something designed and you will get HTML.

## The address

Paths are lowercased, and `.md`, `.markdown`, `.html` and `.htm` are stripped, so `/About.HTML` and
`/about` are the same page. A trailing `index` is dropped: `/docs/index` is `/docs`. Use lowercase
letters, numbers, dashes and slashes.

A page's title is the first heading in its body, or the `<title>` of an HTML document, unless one is
given. The title is what the home page lists it as.

## Working on a live page

A published page can be revised without anyone seeing the half-finished version. Save a draft in
the editor, or ask Claude to work on a draft, and the change goes to the page's working copy while
readers keep getting the live page. Add `?preview` to the page's address, signed in to the admin,
to see the working copy exactly as it would be served, templates and all; anybody else asking for
`?preview` just gets the live page. Publish makes the working copy live, and discard throws it away.

Look at the preview before publishing. Nothing builds the site, so the preview is the only place a
broken [template](templates.md) shows up before a reader finds it.

A page that has never been public doesn't need a working copy: make its path
[private](privacy.md) while it is written and share a link to it.

## Meta

A page can carry facts that are not its body: a date, a kind, a one-line summary. They sit beside
the body as `meta`, a set of names and text values, so the body stays exactly what you wrote and the
list of pages can report them without reading a single page.

Every value is text. A date written `2026-09-30` and a number written with its leading zeros both
sort correctly as text, and a value never changes type because it passed through the editor. A name
starts with a letter; `path` and `title` are refused, because the page already has both.

Changing one fact changes one name: the rest are kept, and the body is not sent again. In the
admin editor meta is one `name: value` per line.

## The home page lives at /root

The home page is the page stored at `/root`, and it is served at `/`. Until you write one, `/` is
the contents of the site instead: a list of every public page, generated on every request, which
nobody has to keep current. Publish at `/root` and your page replaces the list; delete it and the
list comes back.

`/` itself is never a page path, because it would be a second name for the same page. `/root` is
also what you make private to close the site to the public, where a share link for the whole site
points, and where the [favicon](assets.md) lives. `/root` itself redirects to `/`, so the home page
has one address.

A private page is left out of the list for everyone, link holders included, because a page that
varied by who was asking could not be cached, and the next visitor would get somebody else's copy.

## Editing

Ask for a change and Claude replaces the part it is changing, leaving every other byte alone. That
is cheaper than rewriting the page, and safer: a hand-written HTML page survives an edit to one
paragraph.

The admin has an editor for the times it is faster to fix a word yourself. It shows the page's path
and offers a link to move it, never a box to retype it in: retyping a path writes a new page and
strands everything filed under the old one. See [copy, move and delete](transfer.md).

## A page that lists things should fetch them

If a page holds a list you will add to — products, posts, events, opening times — the list belongs
in a [collection](collections.md) and the page should fetch it. The page is then written once and
the list changes without it. This is the one piece of advice on this whole site that saves real
work, and it is easy to skip on the day the list has three things in it.
