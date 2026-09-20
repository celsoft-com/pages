---
title: Working with Claude
order: 10
---

# Working with Claude

The site has no page builder, no templates and no drag and drop. You describe what you want and
Claude writes it, publishes it, and changes it when you ask again. This page is about asking well.

Everything below assumes the connector is set up. If it is not, start at
[getting started](getting-started.md).

## Say what the page is for, not what to type

Claude writes better from a purpose than from dictation.

> Make a page for my kitchen work. Six or seven photos, a short paragraph each, and my phone number
> at the bottom. Keep it plain and readable.

You will get a whole page. Then correct it in place:

> The intro is too long, cut it to two sentences. And move the phone number under the heading.

Claude edits the part it is changing rather than rewriting the page, so the rest of it stays exactly
as it was, including anything you had it write earlier.

## Ask it to go and find out

Claude can research first and publish second, and the second half is one instruction:

> Find the opening times and ticket prices for the three museums in Coburg, check them against the
> official sites, and publish a page at /coburg/museums with a table.

Ask it to say where the facts came from. It will put the sources on the page if you ask, and leave
them off if you do not.

## When something repeats, ask for data

The single most useful habit: the moment a page holds a *list* of anything you will add to later,
say so.

> Keep the museums as data rather than typing them into the page.

Claude puts each one in a [collection](collections.md) and writes a page that fetches it. Then
adding the fourth museum is one sentence, and the page itself never changes:

> Add the Naturkunde-Museum to the museums, opens at 9, adults €5.

Without that, changing an opening time means rewriting the page. It is the difference between a site
you keep and a site you rebuild.

## Pictures and files

Claude can upload an image it has: one you attached to the chat, one it made, one it fetched. Ask
for it to be filed under the page that uses it.

> Put these three photos under /kitchens and use them on that page.

Files are capped at about 4 MB each, which is the host's limit rather than a setting, so a large
photo has to be made smaller before it goes up. Claude cannot hand you a file back down the chat: to
see one, open its URL. See [assets](assets.md).

## Moving things later

Paths work like folders, so a section of your site is a path and everything under it. When you
outgrow a name, say so:

> Rename /kitchens to /work, everything under it.

That moves the page, the photos and the data in one go, on the server, with nothing passing through
the conversation. Claude will tell you what it could not fix: any page that still links to the old
address. See [copy, move and delete](transfer.md).

## Showing someone a draft

> Make /work private and give me a link for my sister.

A private path disappears for everyone else, and the link opens it. It is a link, not a login:
anyone who has it is in. Good for a draft or a family album, wrong for anything whose exposure would
actually hurt. See [private paths](privacy.md).

## Maps

> Put a map on /tour with the five stops, and route between them by bike.

The stops become data you can edit later, the route is worked out once and stored, and the page
draws both. Ask what the route is made of before you ride it: Claude can tell you how much of it is
on main roads. See [maps](maps.md).

## Two things worth knowing

**It is live.** There is no draft mode and no publish button. When Claude says it published
something, it is on the internet at that address. Ask for a private path first if that matters.

**It never touches a repository.** If Claude starts talking about committing, pushing or waiting for
a deploy, it has the wrong idea of what this site is: ask it to read the site's instructions again.
Your content lives in the site's own storage, never in the code.

## Checking its work

- Your home page lists every public page. Open it.
- The admin lists pages, assets and collections, and has an editor for when you would rather change
  one word yourself than describe it.
- Claude gives you the URL of anything it writes. Open that too. It is the fastest way to catch a
  page that reads well in a chat and badly in a browser.
