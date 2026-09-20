---
title: Images and files
order: 50
---

# Images and files

An asset is a stored file served at its own URL. Images on a page, a PDF, a GeoJSON line, a
stylesheet: anything a browser fetches and the site did not generate.

## Paths and URLs

Give a file a path when you upload it and it is served under `/assets` plus that path:

```
/kitchens/oak.jpg     →   {{site_url}}/assets/kitchens/oak.jpg
```

That also files it in the `/kitchens` [bundle](bundles.md), so it travels with the page when the
page moves.

A file uploaded without a path is stored under a hash of its bytes instead. Those URLs keep working
forever and are cached forever, since the bytes behind a hash cannot change, but they sit in no
bundle and cannot be moved. Prefer a path.

## The site icon

An asset called `favicon.ico`, `.svg`, `.png`, `.webp` or `.jpg` in the `/root` folder is the site
icon, and the first of those names found wins. Uploading one is the whole of changing it: there is
no setting. Until you upload one, the site serves a built-in default, so a brand new site has an
icon before it has a page.

## Size

A file is capped at about 4 MB. That ceiling is the host's limit on a single request, not a policy,
so there is no larger endpoint and no way to send a file in pieces. Something bigger has to be made
smaller first.

## Reading one back

No tool hands back the contents of a file, at either door. A reply is text in the calling agent's
context, and a three megabyte photograph spent there is one nobody can look at.

To read a stored file, fetch its URL over HTTP and save it. A file under a private path answers that
fetch with the same nothing everyone else gets unless the request carries an API token or the
owner's own session, which is also why the admin can open a private image and a stranger cannot tell
it exists.
