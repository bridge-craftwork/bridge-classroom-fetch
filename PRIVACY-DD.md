# Privacy Policy — Bridge Craftwork DD

**Last updated:** 8 November 2026

> The published policy is **<https://bridge-craftwork.com/dd/privacy/>**, the
> URL the store listings point at, served from `site/dd/privacy/index.html` in
> bridge-craftwork-site (a copy of `store/dd/privacy-page.html` here). This file
> is the source; change all three together. It is written for users: what the
> extension reads, message by message, is in `docs/data-sources.md` § 3.9, and
> the store reviewers' version is in `store/dd/submission.md`.

## In short

Bridge Craftwork DD follows the boards you play and look back at on Bridge Base
Online, and works out the double-dummy errors on your own device. Nothing
leaves your browser unless you ask: **DD Details** sends one board to be shown
in more detail, and **DD all** asks Bridge Base for an event's boards.

## What it does

- **While you play**, it analyses each board as it ends and tags it in My Table
  with the errors by you, your partner and the opponents.
- **When you look back** at past events in History, it analyses the boards you
  open, from what Bridge Base's page has already loaded.
- **If you choose DD all**, it asks Bridge Base for the rest of an event's boards
  itself, the way Bridge Base's own page does: one request a second, without your
  login.

It can be hidden or shown from the menu on Bridge Base's deal view.

## What it reads

Only Bridge Base's own record of your boards: the deal, the auction, the play,
the result and the players' Bridge Base usernames, as Bridge Base's page
receives them. It does not read chat, your login or password, or anything else
on the page or in your browser.

## What it keeps

On your device only, and never sent anywhere:

- the analysis of each board, so going back to an event does not repeat the work
  (when storage runs short, about 3,500 boards, the oldest go);
- a tally of errors for each event, for the list of tournaments;
- a short note of the event you are playing, so its tags survive a reload,
  discarded after twelve hours;
- your display settings.

None of this names any player. Removing the extension deletes all of it.

## When anything leaves your browser

- **DD Details**, when you click it, sends that one board — deal, auction, play
  and the players' usernames — to a Bridge Classroom page (bridge-classroom.org
  or bridge-classroom.com), which passes it to the double-dummy viewer at
  bridge-craftwork.com/bridge-solver. The
  [Bridge Classroom privacy policy](https://bridge-classroom.org/privacy#extension)
  covers it from there.
- **DD all**, when you choose it, sends requests to Bridge Base, with your
  username, as Bridge Base's own page does.

Nothing else. No analytics, no telemetry, no advertising, no tracking, and
nothing is sold or shared.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Keeps the analyses and your settings on your device |
| `scripting` | Lets it see your boards as Bridge Base's page receives them, and briefly speed up Bridge Base's card animation when you jump to an error |
| Site access to `www.bridgebase.com/v3/*` | The page it works on |

## Source code

Built from the same open-source repository as Bridge Classroom Fetch,
<https://github.com/bridge-craftwork/bridge-classroom-fetch>, released under The
Unlicense.
