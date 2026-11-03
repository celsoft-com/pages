---
title: Getting started
order: 5
---

# Getting started

Three steps once your site is running: make the owner account, connect Claude, ask for a page.

## 1. Make the owner account

Open `/signup` on your site and sign up. The first account is the owner. After that nobody can sign
up uninvited: invite people at `/invites`.

Your site already serves a home page listing everything you publish. It has nothing on it yet.

## 2. Connect Claude

In Claude, add this as a custom connector:

```
https://<your-site>/mcp
```

Claude sends you to your own site to sign in, and asks you to approve the connection. Approve it.

Claude can now read and write your site as you. A script, a cron job or an agent connects
differently, with a token; see [connecting a client](api.md).

## 3. Ask for a page

Then talk to Claude:

> Publish a page at /about that says who I am. I'm a cabinetmaker in Ashford, I've been doing it for
> twenty years, and I mostly build kitchens.

Claude writes it and publishes it. It is live at `https://<your-site>/p/about` immediately: nothing
is built, no deploy runs, and there is nothing to wait for.

Open your home page and the new page is listed on it.

## Where to go next

- [Working with Claude](with-claude.md): what to ask for, and what it is good at
- [Pages](pages.md): markdown, HTML, and how a page's address is decided
- [Data collections](collections.md): the thing to use before a page grows a list
