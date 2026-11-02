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

Only the History panel's own data: when you open the list of tournaments, an
event or a board, Bridge Base's page loads them from Bridge Base's servers, and
the extension reads a copy of those three responses — your recent events, the
event's list of boards, and each board's deal and play. It reads nothing else
on the page.

**It asks Bridge Base for anything itself only when you choose DD all**, on an
event or from the DD menu on the list of tournaments. It then requests that
event's board list and boards from the same public addresses Bridge Base's page
uses, one request a second, with your Bridge Base username in the board-list
request as Bridge Base's page sends it. No cookies or login go with them. Opening
boards yourself never causes a request from the extension.

It does not read your Bridge Base login or password.

## Where the analysis happens

On your device. The double-dummy solver runs inside the extension, in your
browser. No deal, result or name is sent anywhere for analysis.

## What it stores, and for how long

Two things are kept in the extension's storage, on your device, and never sent
anywhere:

- **The analysis of each board**: the contract, the cards played and what each
  cost, so that going back to an event does not repeat the work. There is no
  time limit. When storage runs short, about 3,500 boards, the oldest are deleted.
- **A tally for each event**: how many errors you, your partner and the opponents
  made on each board, and the event's key. It is small and is kept, so your list
  of tournaments keeps its numbers.

Neither names any player. Bridge Base keeps these games, so anything deleted can
be analysed again. Removing the extension deletes all of it at once.

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
| `storage` | The analyses, the event tallies and the show/hide setting |
| `scripting` | Adds a small script to Bridge Base's page that passes the History panel's data to the extension as Bridge Base loads it. That script makes no request of its own |
| Site access to `www.bridgebase.com/v3/*` | The page the review is drawn on |

## Source code

Built from the same open-source repository as Bridge Classroom Fetch,
<https://github.com/bridge-craftwork/bridge-classroom-fetch>, released under The
Unlicense.
