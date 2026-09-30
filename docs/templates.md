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
  <li><a href="{{ p.path }}">{{ p.title }}</a> {{ p.meta.date }}</li>
{% endfor %}
</ul>
```
````

What it renders is placed exactly where the fence was, and the markdown around it is rendered as
usual. A code block in any other language is shown as code, so writing about Liquid on a page is
still possible.

## What a template can see

- **`page`** is the page being rendered: `path`, `title`, `format`, `updated` and its
  [meta](pages.md).
- **`site.pages`** is every public page, each with the same fields, in path order. Liquid's `where`,
  `sort`, `reverse` and a loop's `limit` and `offset` are how you pick from it.
- **`site.title`** and **`site.description`** are the site's own.
- **`collections["/trip/stops"]`** is a [collection](collections.md)'s items, the same array its
  `/data` URL serves, in collection order. It is read only when a template names it.

A template reads only what its page may show. A public page never sees a private page or a private
collection, because a public page is cached for everyone; a page inside a [private path](privacy.md)
also sees what shares that path with it.

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
