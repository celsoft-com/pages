---
title: Private paths
order: 60
---

# Private paths

A path can be closed to the public and opened with a link. It is the right tool for a draft, a
family album or a client preview, and the wrong tool for anything whose exposure would actually
hurt. The difference matters, so this page says plainly what it is.

## What closing a path does

Making `/trip` private closes `/trip`, every page under it, every collection served under
`/data/trip/` and every asset under `/assets/trip/`. One path, one rule, the same folder rule as a
[bundle](bundles.md).

To anyone without a link, all of it answers exactly as if nothing had ever been published there:
the same document, the same status, the same headers, byte for byte. A private path does not
announce that it exists, which is the whole point. It also drops out of the home page listing, for
everybody, link holders included.

Privacy does not nest — a path inside a private path cannot be a second scope — and `/` cannot be
private, because that is the entire site rather than a path within it. To close a whole site, make
`/root` private.

## The link

A share link carries its secret after the `#`:

```
{{site_url}}/trip#uNqL7v…
```

Browsers never send the fragment to a server. It reaches no access log, no proxy, no `Referer`
header, and a chat or mail app that previews links by fetching them gets the same nothing a stranger
gets. That is what makes the link safe to send through a channel you do not control.

It costs one thing: the token only ever arrives in a browser, so opening a link needs JavaScript on.
The script that reads the fragment rides on the response a stranger already gets, which is why the
closed page and a missing page are the same document.

Pass a link on exactly as given. Trimmed at the `#`, it opens nothing. It is shown once, because
only a hash of it is stored.

## Links are per recipient

Mint one link per person and label it with who it is for. Revoking then kills one person's access
and leaves everybody else working.

Revocation lands on that holder's next request, not whenever their browser would have forgotten
something, because every request checks the link against the stored list. Revoking the last link
leaves the path closed to everyone rather than quietly republishing it.

## What it is not

Anyone holding the link is in. There is no account, no identity and no audit trail beyond when a
link was last used. Treat it as "unlisted, and hard to guess", not as a login.

Making a path public again revokes every link on it, because those links exist only to open
something closed.
