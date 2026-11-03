---
title: Templates
order: 35
---

# Templates

A markdown page can hold templates that the site renders as it serves the page: a list of your
latest essays, a table drawn from a collection, the same card repeated for every item. Templates
are [Liquid](https://liquidjs.com), the language Jekyll and Shopify use, and they run on the
server, so the reader gets finished HTML and needs no script.

## A fence

A template goes in a fenced code block whose language is `pages`:

````
```pages
{% assign essays = site.pages | where: "meta.kind", "essay" | sort: "meta.date" | reverse %}
<ul>
{% for p in essays limit: 5 %}
  <li><a href="{{ p.url }}">{{ p.title }}</a> {{ p.meta.date }}</li>
{% endfor %}
</ul>
```
````

What it renders is placed exactly where the fence was, and the markdown around it is rendered as
usual. A code block in any other language is shown as code, so writing about Liquid on a page is
still possible.

## What a template can see

- **`page`** is the page being rendered: `path`, `url`, `title`, `format`, `updated`, its
  [meta](pages.md), `words` (the prose in its body, not counting code or markup) and `minutes`, a
  reading time at 230 words a minute and never less than one.
- **`site.pages`** is every page a stranger may read, each with the same fields, in path order. Liquid's `where`,
  `sort`, `reverse` and a loop's `limit` and `offset` are how you pick from it. A page's `path` is
  where it is filed and its `url` is where a reader opens it: `/p` followed by the path, or `/` for
  `/root`. Link with the `url`.
- **`site.title`** and **`site.description`** are the site's own.
- **`build`** is the deploy serving the page: `description` is one line saying when and from what
  it was deployed, and `built`, `commit`, `branch` and `target` (`production` or `preview`) are its
  parts.
- **`collections["/trip/stops"]`** is a [collection](collections.md)'s items, the same array its
  `/data` URL serves, in collection order. It is read only when a template names it, and a
  collection under a [private path](privacy.md) reads as missing.

A link built some other way, from a path held in a variable, goes through the `page_url` filter:
`{{ "/" | append: kind | page_url }}` gives the URL of the page at that path, and leaves `/assets`,
`/data` and outside addresses as they are.

Everything printed is escaped, so a `<` in a collection field shows as a `<` rather than breaking
the page. Pipe a value through `raw` when it holds HTML you mean to keep.

## Stored templates

A template used in more than one place can be stored once as an html page holding the fragment,
for example at `/root/templates/card`, and rendered from a fence:

```
{% render "/root/templates/card", item: item %}
```

It is an ordinary page, edited like any other. The site's header and footer are stored templates
too, named in the settings, and they see the page they wrap; see [pages](pages.md).

## When one breaks

A template that fails renders its error in place of its output, so one bad fence costs its own block
and the rest of the page still renders. There is no build to catch it first, so look at a page after
changing a template. A loop that runs too long is stopped rather than left to hang the site.

HTML pages are served exactly as written and never run a template.
