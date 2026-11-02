# Privacy Policy — Bridge Craftwork DD

**Last updated:** 1 November 2026

> The published policy is **<https://bridge-craftwork.com/dd/privacy/>**, the
> URL the store listings point at, served from `site/dd/privacy/index.html` in
> bridge-craftwork-site (a copy of `store/dd/privacy-page.html` here). This file
> is the source; change all three together.

## Overview

Bridge Craftwork DD is a browser extension that adds double-dummy review to
the **History** panel of Bridge Base Online's web client
(`www.bridgebase.com/v3/`). For each board you open there, it marks the cards
that cost a trick, shows what should have been played, and totals the errors
for the event.

It can be hidden or shown from the menu on BBO's deal view
("Hide / Show Bridge Craftwork DD").

## What it reads

Only the History panel's own data: when you open an event or a board, Bridge
Base's page loads them from Bridge Base's servers, and the extension reads a
copy of those two responses — the event's list of boards, and each board's
deal and play. It makes **no requests of its own** to Bridge Base, and reads
nothing else on the page.

It does not read your Bridge Base login or password.

## Where the analysis happens

On your device. The double-dummy solver runs inside the extension, in your
browser. No deal, result or name is sent anywhere for analysis.

## What it stores, and for how long

The analysis of each board you open is kept in the extension's storage, on
your device, for **14 days**, so that going back to an earlier event does not
repeat the work. Each entry holds the deal, the cards played, the four players'
Bridge Base usernames and the result of the analysis. It is never sent
anywhere and is deleted automatically after 14 days. Removing the extension
deletes it at once.

Whether the display is shown or hidden is also kept, so your choice holds.

## Where results go

Nowhere, unless you click the **DD Details** button on a board. That sends that
one deal, its auction and play, and the players' Bridge Base usernames to a
Bridge Classroom page (bridge-classroom.org or bridge-classroom.com), which
passes them on to the double-dummy viewer at bridge-craftwork.com/bridge-solver.
The [Bridge Classroom privacy policy](https://bridge-classroom.org/privacy#extension)
governs them from there.

There are no analytics, no telemetry, no advertising and no tracking.

## Permissions

| Permission | Why |
|---|---|
| `storage` | The 14-day analysis cache and the show/hide setting |
| `scripting` | Adds a small script to Bridge Base's page that passes the History panel's boards to the extension as Bridge Base loads them, without making any request of its own |
| Site access to `www.bridgebase.com/v3/*` | The page the review is drawn on |

## Source code

Built from the same open-source repository as Bridge Classroom Fetch,
<https://github.com/bridge-craftwork/bridge-classroom-fetch>, released under The
Unlicense.
