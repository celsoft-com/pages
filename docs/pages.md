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

Write a full HTML document, starting `<!doctype html>` or `<html>`, and it is served byte for byte.
Your own CSS, your own scripts, a library from a CDN, a map, a canvas, whatever you like. The site
adds nothing to it and takes nothing out, which is also why it cannot give it a favicon tag or a
theme toggle: a verbatim document is verbatim.

Which one you get is detected from the content unless you say. Ask Claude for "a plain page" and you
will get markdown; ask for something designed and you will get HTML.

## The address

Paths are lowercased, and `.md`, `.markdown`, `.html` and `.htm` are stripped, so `/About.HTML` and
`/about` are the same page. A trailing `index` is dropped: `/docs/index` is `/docs`. Use lowercase
letters, numbers, dashes and slashes.

A page's title is the first heading in its body, or the `<title>` of an HTML document, unless one is
given. The title is what the home page lists it as.

## The home page is not a page

`/` is the contents of the site: a list of every public page, generated on every request. Nobody
writes it, nobody has to keep it current, and it cannot be published to, edited or deleted. Publish
anywhere else and it appears there.

It is still a path, and its name is `/root`. That matters in three places: it is what you make
private to close the site to the public, it is where a share link for the whole site points, and it
is where the [favicon](assets.md) lives. `/root` itself redirects to `/`, so the contents has one
address.

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
