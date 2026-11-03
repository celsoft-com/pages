---
title: Private paths
order: 60
---

# Private paths

A path can be closed to the public and opened with a link. It is the right tool for a draft, a
family album or a client preview, and the wrong tool for anything whose exposure would actually
hurt. The difference matters, so this page says plainly what it is.

## What closing a path does

Making `/trip` private closes the page at `/trip`, every page under it, every collection served
under `/data/trip/` and every file under `/assets/trip/`. One path, one rule, the same folder rule
as a [bundle](bundles.md). You, the owner, still see and change all of it.

To anyone without a link, all of it answers exactly as if nothing had ever been published there: the
same not-found page as an address with nothing at it. A private path does not announce that it
exists, which is the whole point.

Privacy does not nest: a path inside a private path cannot be a second private path, and a path
above one cannot be closed over it. `/` cannot be private, because that is the entire site rather
than a path within it. To close the home page, make `/root` private.

Leaving private pages out of the site's contents at `/`, the index of collections and what templates
list is not available yet. Until it is, the title and path of a private page show in those lists,
though the page itself stays closed.

## The link

A share link carries its secret after the `#`:

```
https://<your-site>/p/trip#link=uNqL7v…
```

Browsers never send that part to a server. It reaches no access log, no proxy, no `Referer` header,
and a chat or mail app that previews links by fetching them gets the same nothing a stranger gets.
That is what makes the link safe to send through a channel you do not control.

It costs one thing: the secret only ever arrives in a browser, so opening a link needs JavaScript
on. The browser keeps it after that, so the rest of the path opens too.

Pass a link on exactly as given. Trimmed at the `#`, it opens nothing. It is shown once, because
only a hash of it is stored.

## Links are per recipient

Mint one link per person and label it with who it is for. Revoking then ends one person's access
and leaves everybody else working. A label is used once per path.

Revoking lands on that holder's next request, not whenever their browser would have forgotten it,
because every request checks the link. Revoking the last link leaves the path closed to everyone
but you rather than quietly republishing it.

The list of links shows who each is for, when it was made and when it expires. When a link was last
used is not kept.

## What it is not

Anyone holding the link is in. There is no account and no identity behind it. Treat it as
"unlisted, and hard to guess", not as a login.

Making a path public again revokes every link on it, because those links exist only to open
something closed.

Moving or copying something out of a private path makes it public at its new address, and moving
something into one closes it. Claude is told when either happens, so it can tell you.
