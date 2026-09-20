---
title: Getting started
order: 5
---

# Getting started

Four steps, no checkout, no command line. If you can click a button and pick a password, you can run
this site.

## 1. Deploy it

Press the deploy button in the [overview](/docs). Netlify asks for an account, copies the repository
into it and builds the site. That takes a minute or two and happens once.

You get an address ending in `netlify.app`. That is your site.

## 2. Pick a password

Open it. A new site says it is ready to set up and offers one link, **Set up this site**.

Pick a password and you are the owner. That is the whole of setup: there are no accounts to create
and nobody else to invite, because a site has one owner and everything else is either published or
closed.

Your site now serves a home page listing everything you publish. It has nothing on it yet.

## 3. Connect Claude

In the admin, open **Connections**. It shows one URL:

```
{{mcp_url}}
```

In Claude, add that as a custom connector. Claude sends you back to your own site to sign in with
the password you just picked, and asks you to approve the connection. Approve it.

Claude can now read and write your site. Nothing else can: the connection is to your site, from your
Claude account.

A script, a cron job or an agent connects differently, with a token you mint on the same screen.
See [connecting a client](api.md).

## 4. Ask for a page

Then talk to Claude:

> Publish a page at /about that says who I am. I'm a cabinetmaker in Coburg, I've been doing it for
> twenty years, and I mostly build kitchens.

Claude writes it and publishes it. It is live at `{{site_url}}/about` immediately: nothing is built,
no deploy runs, and there is nothing to wait for.

Open your home page and the new page is listed on it.

## Where to go next

- [Working with Claude](with-claude.md) — what to ask for, and what it is good at
- [Pages](pages.md) — markdown, HTML, and how a page's address is decided
- [Data collections](collections.md) — the thing to use before a page grows a list
