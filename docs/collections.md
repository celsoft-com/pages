---
title: Data collections
order: 40
---

# Data collections

A collection is an ordered list of records at a path, stored as JSON and served to anything that
asks. It is how a page stops being a document and starts being a thing you maintain.

## What it is

Give it a path, like `/products`, and it is served at `/data/products.json` as a bare array:

```json
[
  { "id": "pils", "name": "Pilsner", "price": 3.4 },
  { "id": "dunkel", "name": "Dunkel", "price": 3.8 }
]
```

No wrapper object, no metadata, every item carrying its own `id`, in the order you set. A page
fetches that and renders it:

```html
<ul id="beers"></ul>
<script>
  fetch('/data/beers.json')
    .then(function (r) { return r.json(); })
    .then(function (items) {
      document.getElementById('beers').innerHTML =
        items.map(function (i) { return '<li>' + i.name + ' — €' + i.price + '</li>'; }).join('');
    });
</script>
```

Publish that page once. Everything after it is a change to the data.

`GET /data/_collections.json` lists every collection with its path, URL, item count and revision, so
a page can discover what exists with no credentials at all.

## Records change one at a time

Adding, changing, reordering and deleting all work on a single item. Changing a price does not send
the collection anywhere; it writes one field. Nested objects and arrays inside an item are stored
and served exactly as given, though merging is shallow: a nested value replaces the stored one
rather than being merged into it.

Order is yours and it is preserved, so a page can render the array as it arrives without sorting.

## Revisions

Every item carries a revision number, kept outside the stored JSON so it never shows up in what the
URL serves. A write passes back the revision it read, and a write built on a stale read is refused
rather than quietly overwriting a newer one. It is the reason two clients editing the same site
cannot silently clobber each other.

## References catch typos

When a field on one collection holds an id from another — a category, a section, a status, an owner
— declare it. Then a value that matches no id is rejected when it is written.

This is worth doing because of how the failure looks without it. The write succeeds. The JSON is
valid. The page renders. The record simply stops appearing wherever that value is used to select it,
and nobody finds out until they go looking for something they know should be there.

Declare the constraint when the collection is new, before there are records to audit. For records
written earlier, an audit finds the damage, and it reports how much it actually checked: a
collection with nothing declared comes back saying nothing was checked, not that everything is fine.

## It is public

The served JSON is unauthenticated. A collection under a [private path](privacy.md) is served only
to a browser holding a share link, and is left out of the index entirely. Anywhere else it is
readable by anyone who guesses the path, exactly like a page. Put nothing in one that you would not
publish.
