# Data Sources and Acquisition Methods

What this project reads, from where, by what mechanism, and under what
authentication. Written because the *how* is unusually load-bearing here: three
different sites each broke a naive `fetch()` in a different way, and the
workarounds are not obvious from reading the adapters alone.

For what the data means once captured, see
[normalized-schema.md](normalized-schema.md); each envelope declares its own
`coverage`, and this document explains why those values are what they are.

---

## 1. Summary

| Source | Host | Auth | Testable logged out? | Mechanism |
|---|---|---|---|---|
| ACBL Live tournaments | `live.acbl.org` | ACBL login | **No** — Cloudflare, then a login prompt | **Fetch inside a same-origin tab** |
| ACBL club games | `my.acbl.org` | **None** — results are public | **Yes**, after a Cloudflare check | **Fetch inside a same-origin tab** |
| BBO hands list | `www.bridgebase.com/myhands/` | BBO login | **No** — redirects to `myhands_login.php` | Service-worker fetch, `credentials: 'include'` |
| BBO traveller | `www.bridgebase.com/myhands/` | BBO login | **No** | Service-worker fetch, `credentials: 'include'` |
| BBO event listing | `www.bridgebase.com/myhands/` | BBO login | **No** | **Off-screen minimized popup window** |
| BBO tournament summary | `webutil.bridgebase.com/v2/tview.php` | **None, deliberately** | **Yes** | Service-worker fetch, `credentials: 'omit'` |
| BBO replay LIN | `www.bridgebase.com/myhands/fetchlin.php` | None | **Yes** | **CLI, outside the browser** |
| BBO hand viewer | `www.bridgebase.com/tools/handviewer.html` | None | **Yes** | **No fetch — the deal is in the URL** |
| BBO History board list | `webutil.bridgebase.com/v2/mh_list.php` | None | **Yes** | **No fetch — copied from BBO's own request** |
| BBO History board | `webutil.bridgebase.com/v2/mh_hand.php` | None | **Yes** | **No fetch — copied from BBO's own request** |

"Testable logged out" is the property that matters for store review: it says
whether someone with no account can exercise that path. Verified in a clean
browser profile, August 2026. The hand viewer is the one entry point that needs
no account, no cookies and no Cloudflare pass — see
[store-review.md](store-review.md).

---

## 2. Acquisition mechanisms

### 2.1 Direct service-worker fetch

The default. Used for both authenticated BBO pages, with
`credentials: 'include'` so the browser attaches its stored BBO cookies;
`host_permissions` allows this cross-origin.

### 2.2 Anonymous service-worker fetch

`credentials: 'omit'` — used for BBO's tournament summary, where the omission is
the point (see [§ 3.3](#33-bbo-tournament-summary)), and for `fetchlin.php` when
the hand viewer's `myhand=` form has to be resolved.

### 2.3 Fetch inside a same-origin tab

Both ACBL properties reject direct service-worker fetches with **HTTP 403**,
even with `credentials: 'include'` and `host_permissions` granted. The service
worker is a *cross-site* context, so Chrome withholds `SameSite=Lax` cookies —
and ACBL's 2026 auth change made those cookies mandatory (`my.acbl.org` in May,
`live.acbl.org` in June).

The fix is to run the fetch from inside a tab that is already same-site:

```
chrome.scripting.executeScript({ target: {tabId}, world: 'MAIN',
  func: (u) => fetch(u, { credentials: 'include' }).then(...) })
```

Tab selection is not blind. `pickInjectableTab()` ranks candidates because
`tabs[0]` frequently isn't scriptable — it may be discarded by Chrome's memory
saver, mid-navigation, or sitting on a login page, and `executeScript` then
fails with "Cannot access contents of the page" while a perfectly good tab is
open elsewhere. Ranking prefers the tab the user is looking at, still loaded,
and finished loading.

If no usable tab exists, a temporary window is opened and closed afterwards
(see below). Reusing an open tab is preferred: no flicker, no extra page load.

### 2.4 Off-screen minimized popup window

Used when a page must be *rendered* rather than merely fetched — the BBO event
listing, and as the fallback for §2.3.

```js
browser.windows.create({ url, type: 'popup', focused: false,
  state: 'minimized', top: -2000, left: -2000, width: 200, height: 200 })
```

Both minimized *and* off-screen, because BBO's redirect chain (timezone →
`hands.php` → possibly login) navigates several times and can unminimize the
window on some platforms. A `state: 'minimized'` rejection falls back to a plain
minimized window. The window closes itself once parsing finishes.

### 2.5 Content scripts

Injected UI and in-page parsing, not a fetch mechanism as such:

| Script | Runs on | Job |
|---|---|---|
| `sourceContent.js` | ACBL + BBO result pages | Injects the "Analyze" button |
| `bboLobbyContent.js` | `bridgebase.com/v3/*` | Injects history UI; drives batch and dev bulk export |
| `ingestContent.js` | `bridge-classroom.{org,com}/*` | Hands the envelope to `/ingest` (see [ingest-protocol.md](ingest-protocol.md)) |
| `bbo-page-hook.js` | `bridgebase.com/v3/*`, **in the page's own world** — Bridge Craftwork DD only | Copies BBO's `mh_list`/`mh_hand` responses to `ddContent.js` (§ 3.9) |
| `ddContent.js` | `bridgebase.com/v3/*` — Bridge Craftwork DD only | The double-dummy review and its Show/Hide menu item |

Three content scripts in Fetch's `manifest.json`. Bridge Craftwork DD
(`manifest.dd.json`) has `ddContent.js` and `ingestContent.js`, plus the page
hook, which its background registers at runtime (§ 3.9 says why). A fourth,
`analyzerContent.js`, wrote the envelope into the analyzer page's
`sessionStorage`; it was removed when `/ingest` became the only destination.

The SPA-heavy pages need a `MutationObserver` to re-inject the button, since
navigation destroys it without a page load.

### 2.6 Command-line fetch, outside the browser

`tools/fetch-replays.js` fetches replay LINs directly. It lives outside the
extension because that endpoint needs no authentication and the volume is far
too large for a browser session — see [§ 3.5](#35-bbo-replay-lin).

---

## 3. Per-source detail

### 3.1 ACBL Live tournaments — `live.acbl.org`

**Mechanism:** tab-routed fetch (§2.3). **Concurrency 16**, no delay.

Entry point is a pair scorecard or a `/summary` page. From there:

1. Fetch the initial scorecard.
2. Fetch sibling session scorecards from the session dropdown.
3. Follow the user across sessions — pair numbers change between sessions, so
   the user is re-located in each session's `pair_directory`.
4. Build a fetch plan of **session × section × board**. Every section is
   covered: `uniqueSections()` reads them from the pair directory, since a
   board-detail page shows only one section.
5. Fetch and parse on the fly, overlapping parse with network.

**Yields:** contracts, results, scores, matchpoints/IMPs, strat ranks,
masterpoint awards, real player names, ACBL player IDs, double-dummy data,
section labels.

**No cardplay and no auction.** ACBL Live publishes neither. The auction inside
the BBO handviewer links on board-detail pages is **synthetic — not the auction
played** — and is deliberately not extracted.

### 3.2 ACBL club games — `my.acbl.org`

**Mechanism:** tab-routed fetch (§2.3). Single page fetch.

The page embeds a `<result-details>` element whose attribute carries the entire
game as JSON; there is no per-board fetching. Handles Howell movements, missing
pairs, `#`-prefixed IDs, and normalises player names across scoring software
(RSVP Bridge titles, middle initials, `Last, First` ordering).

**Yields:** as above, all sections, real names. No cardplay, no auction.

### 3.3 BBO tournament summary — `tview.php`

**Mechanism:** service-worker fetch with **`credentials: 'omit'`**.

The only BBO page carrying section identity, and the only reliable source of the
event name — the hands list carries the name on a minority of events (26 of 264
in one real capture), while this page states it every time.

**The anonymous fetch is a privacy decision, not a limitation.** Authenticated,
this page shows real player names for the whole field. Anonymous, BBO withholds
names but still returns sections, directions, strat ranks and masterpoint
awards. Fetching it without cookies therefore yields everything wanted and no
opponents' personal information. A test asserts `credentials: 'omit'` here while
the hands list and travellers keep `'include'` — collapsing the two fetch
wrappers would silently start collecting names.

The viewing player is identified from the username already in hand, **not** from
BBO's `highlight` row class, which is also applied to friends' rows.

**Yields:** event title, table count, sections, directions, strat ranks,
masterpoint awards, pseudonymous usernames.

### 3.4 BBO hands list and travellers — `myhands/`

**Mechanism:** service-worker fetch, `credentials: 'include'`.
**Concurrency 2, 200 ms apart** — at concurrency 4 BBO returns its
timezone-redirect page instead of game HTML for most requests, so failures are
detected by shape and retried sequentially with a longer delay.

- **Hands list** (`hands.php?tourney=<id>-&username=<user>`) — the user's own
  boards, with the full LIN for **their table only** embedded in an `onclick`
  attribute. Cardplay costs no extra fetch.
- **Traveller** (`hands.php?traveller=<id>&username=<user>`) — one per board,
  carrying **one row per table across the entire event**. Verified against
  `tview.php`: a 4-section, 54-table event yields 54 rows on a board. Travellers
  are field-wide, not section-scoped, but carry no section marker.

**Yields:** every table's contract, declarer, tricks, score and MP/IMP
comparison; the user's own auction and cardplay; BBO usernames.

### 3.5 BBO replay LIN — `fetchlin.php`

**Mechanism:** command-line fetch (§2.6). **No authentication.**

Every traveller row carries `handviewer_url` containing
`myhand=M-<handId>-<timestamp>`, whose two components are exactly this
endpoint's parameters — so no discovery step is needed. It returns the full LIN
for any table's play: real auction and all 52 cards.

**Rate limited far more tightly than anything else here:** roughly 0.5 req/s.
Measured — 8 concurrent requests and 1 s spacing both drew HTTP 429 within a
handful of requests; 2 s spacing sustained 150 consecutive requests with none
refused. The limiter answers with a 117-byte HTML page, so responses are
validated by *shape*, not status code, or the error would be stored as though it
were cardplay.

At that rate a full history is a multi-day job, which is why it runs detached
with a resumable journal rather than in the browser.

### 3.6 BBO hand viewer — `tools/handviewer.html`

**Mechanism: usually none.** The `lin=` form carries the entire deal — players,
dealer, vulnerability, all four hands, auction and every card played — in the
URL itself, so extraction is pure parsing with no network access at all. The
`myhand=M-<id>-<ts>` form resolves through `fetchlin.php` (§3.5), anonymously.

The most reachable page immediately after playing a board, which makes it the
natural entry point for checking one hand between rounds.

**Yields:** one table, fully. Contract and declarer are *derived* from the
auction rather than read — declarer being whoever on the declaring side named
the strain first, not whoever made the final bid.

**Coverage:** `user-table` throughout, `sections: not-applicable` — a single
deal has no field to compare against.

The button is injected into BBO's own control row (`#buttonDiv`) rather than as
a floating overlay: the auction occupies top-right where the overlay pins, BBO's
controls run along the bottom, and BBO Helper draws a double-dummy table
bottom-left.

### 3.6a Where the button goes on each BBO page

The floating overlay is the fallback, not the preference — it pins to the
viewport at top-right and covers whatever is underneath, which varies with zoom.
Where a page has somewhere of its own to put the button, it goes there.

| Page | Placement |
|---|---|
| Lobby (`/v3/*`) | Above the history list (`historic-tournament-list .listClass`), by the separate lobby content script |
| Hands list (`hands.php?tourney=`) | Merged into the table's own header: the two full-width rows (tourney name, date) shrink from `colspan="11"` to `7`, and a `<th colspan="4" rowspan="2">` holds the button |
| Traveller (`hands.php?traveller=`) | **No button, by decision.** BBO already analyses one board across the field there, so we would be duplicating it; and reaching it takes several clicks past pages that *do* have a button |
| Tournament view (`tview.php?t=`) | Floating overlay — no comparable spare row to merge, and it lands on ad margin rather than any control |
| Hand viewer (`handviewer.html`) | BBO's control row, as above |

Both in-page placements fall back to the overlay if the markup isn't the shape
they expect. Losing placement to a BBO change is acceptable; losing the button
is not.

### 3.7 BBO double-dummy — `dd.php` (observed, not used)

**Not used.** Recorded because the question "why don't we just use BBO's own
solver?" is otherwise easy to re-open.

BBO's hand viewer computes double-dummy **server-side**. Its `DD` button issues
XHR calls to `dd.php` from `handviewer.js`, one per position, passing the deal
as a plain string (`s=s T543.QT73.AJ8…`) and receiving 0.5–0.8 kB back.
Measured in DevTools: **320–480 ms per call**, six calls to step through a
single hand.

That latency is the reason stepping through a replay card by card feels slow in
the existing tools — every step is a round trip.

**Why it can't serve bulk analysis.** Card-by-card double-dummy over a
14,280-replay backfill is roughly **743,000 positions**. At ~400 ms serial
that is ~82 hours before any rate limiting, against someone else's solver. A
local solver is the only workable route, and any display built on this data has
to read precomputed results rather than call out per position.

**Where it is still useful.** As a validation oracle. The `s=` parameter is a
plain deal string constructible straight from `board.deal`, so spot-checking a
few hundred local solver results against BBO's answers would catch a systematic
error — a suit-order or seat-rotation bug — far more cheaply than reasoning
about it. A few hundred calls is a couple of minutes and a polite volume.

### 3.8 BBO event listing — `bridgebase.com/v3/*`

**Mechanism:** off-screen minimized popup window (§2.4), driven by
`bboLobbyContent.js`.

BBO caps a listing query at roughly a 30-day range, so multi-year history is
collected in **28-day chunks, newest first**. Between batch items: **250 ms** for
BBO hosts, **1 s** for ACBL hosts, which need more breathing room.

### 3.9 BBO History panel — `tfind.php`, `mh_list.php` and `mh_hand.php`

**Mechanism:** none of our own for what the user opens. The v3 client's History
panel loads all three as the user opens the list, an event and its boards; a page
hook copies the responses to the content script. **DD all** is the one exception:
the content script asks for the last two itself, when the user chooses it. Used by **Bridge Craftwork DD**, the second extension built
from this repo (`EXT=dd`), for its double-dummy review
(`src/ui/bboDdOverlay.js`). Fetch does not read them.

Found by watching the panel's traffic, 1 Nov 2026:

| The user… | BBO requests | Returns |
|---|---|---|
| Opens Recent tournaments | `POST tfind.php`, `u=kemistry` | `<tourneys>`: per event, `tkey`, `tourney_number`, `title`, `teamname`, `format`, `ustarted`, `award`. 33 events back about three months (2 Nov 2026) |
| Opens an event | `POST mh_list.php`, `tkey=33873-1793548800&username=kemistry` (+ `format`, `teamname`, `merge`) | `<sc_boards>`: per board, a `resultkey`, the result, score, and **each seat named by attribute** (`north=` …) |
| Opens a board (board 1 opens with the event) | `POST mh_hand.php`, `hk=<resultkey>` | `<linhand>`: the full LIN — deal, auction with alerts, **every card played**, claim |
| Steps through tricks | **nothing** | The panel replays the LIN it already has |

All three answer **without a login** — checked with `curl` and no cookies — and send
`Access-Control-Allow-Origin: *`. `tkey` is the number in the panel's title bar
plus the event's start time; it is the same key `hands.php` puts in its
`tview.php?t=` links. BBO fetches each board once per visit and keeps it, so
returning to a board loads nothing: the overlay identifies the board on screen
by matching its hand panels against the deals it has seen, not by the last
response.

`mh_list`'s seat attributes and the LIN's positional `pn|` (S, W, N, E) agree —
two independent sources, pinned in `tests/adapters/bbo/mhXml.test.js`.

**The last column is BBO's Prize, showing `award`.** Blank at zero, so DD's tally
uses it and relabels the header; a row with `award` above zero keeps its prize, with
the tally in the tooltip. A real prize row has not been seen in the panel: all 33
rows here were zero, though robot races do pay.

**Daylongs have no boards here.** Their `tkey` is `ARDARD:<uuid>-<time>`, and
`mh_list` answers with an empty `<sc_board_group/>` for BBO's own panel too. They
show `–` in the tally column and are not asked for again.

**DD all** (`src/lib/ddBatch.js`) sends the panel's own parameters from the content
script: one request at a time, a second apart, `credentials: 'omit'`, stopping
after three failures in a row. It needs no host permission, because of the
`Access-Control-Allow-Origin: *` above. It resumes from the tallies, so a complete
event costs no requests. Measured 2 Nov 2026: three 12-board events, 39 requests in
about 46 s, no console errors. Three clean runs stayed signed in. One earlier run lost
BBO's connection partway ("Connection lost") after its script had clicked into
Practice by mistake; it did not recur, but the cause was not established.

**Why copy rather than fetch, for boards the user opens.** It costs BBO nothing extra, and it is
available sooner: `myhands/hands.php` lags an event by about a minute, while
this is what BBO's own panel shows as each board finishes. Not yet seen during
a live event — whether the auto-loaded board arrives through `mh_hand.php`, as a
click does, or over the websocket is the open question.

**Seated at a table, two viewers are on screen.** The table's comes first in the
page, then History's. 1.1.0 as first built drew on the first visible one, so a
player seated at a table saw tags and totals but nothing on the board, not even
DD Details (6 Nov 2026, found by reading the page from DevTools during a live
event). The overlay now tries every visible viewer, and takes the trick buttons
nearest History's.

**When both fit, the last viewer wins.** A board just finished stays at the
table, as its last few cards or as the whole deal for review, and fits the
board as well as History's does. Preferring the viewer showing the most cards
looked right and was wrong twice on 8 Nov: the review ties History at 52, and
once the player steps into the play History shows fewer. Page order is what
holds — the table's first, History's after — so `matchPanels` takes the last.

**My Table must not borrow another event's tags.** No board list we see arrives
for the event being played. On 6 Nov My Table carried #33873's tags and totals,
because the overlay fell back to the last list loaded. Tags and totals are now
drawn only when the results on screen agree with the list's (`listOnScreen`).

**My Table, pairs and teams: `sc_board_details` on the game connection.** Opening
a board sends `cs_get_board`; the answer is `<sc_board_details request_id=
"d~t~52031~1~16~0">` holding `<sc_deal>` (hands, dealer, vulnerability, names),
each `<sc_call_made>` and each `<sc_card_played>`, closed by
`</sc_board_details >` — with a space, so the close is matched by pattern. Most
frames are binary and a long message arrives in pieces. `parseBoardDetails`
(`src/adapters/bbo/parsers/liveXml.js`) turns it into LIN; its key is
`live:` + the request id. Checked against BBO's own `mh_hand.php` for the same
board: identical but for rank order. Working live, 8 Nov 2026.

A board is sent only when opened, so the overlay keeps a short record of the
event in progress (`ddl:table`: board number, key, result, the user's seat — no
names, latest event only, twelve hours) to put My Table's tags back after a
reload. The marks on the cards still wait for a click, since the deal is not
stored.

**My Table, daylongs: `ard.php`.** A robot game is not played over the game
connection. The deal comes from `bboardapi.bridgebase.com/ard_v1/deal` and each
robot move from `ard_v1/poll` (`<events>` holding `sc_call_made`,
`sc_card_played`, `sc_claim_accept`, and at the end `sc_player_holds` and
`sc_deal_complete result="4CS-1"`). History's My Table is filled from
`webutil.bridgebase.com/v2/ard.php`, whose `<deals tid="…">` answer holds every
board so far, each `dealstring` a LIN with `result` and the four names as
attributes — read by `parseArdDeals`, key `ard:<tid>:<round>:<board>`. The hook
copies `ard.php` only when the answer is `<deals>`. BBO asks for it on load but
not after each board, nor on Refresh, so a board finished since the page loaded
appears only after a reload. Reading the polls is the open item; it needs one
`deal` answer and a poll after the player's own card, still to capture. A
passed-out board is `P` there and `Pass` on screen.

**Why registered at runtime, not in the manifest.** crxjs loads every manifest
content script through a dynamic `import()` of an extension URL. In the page's
own world that import is subject to BBO's CSP, whose `script-src *` admits no
extension scheme. `scripting.registerContentScripts({ world: 'MAIN' })` injects
the file directly, so the CSP never applies. The file lives in `public/` and is
copied unbundled.

**The hook also shortens BBO's animation, on request.** Stepping the viewer to an
error's trick presses BBO's own Next trick, and BBO animates each trick as
`setTimeout(…, 750)` per card plus a 2-second pause, about 2.3 s a trick
(measured; its Animation setting removes them but is read only at startup). For
the length of a jump the hook cuts delays of 200–2000 ms to 10 ms, then
restores them, with a 15-second failsafe. Measured: trick 3 from the start in
~1 s instead of ~7 s, and BBO's own Next trick back to 2.3 s afterwards.

**Casual play is not covered.** Casual tables have no `tkey`; the Recent hands
tab loads them some other way, not yet captured.

The analysis runs in the background, in bridge-solver's WASM
(`Analyzer.dd_play`, ~40 ms for 52 cards). Each board is cached by `resultkey`
(about 2 KB; oldest deleted past `MAX_BOARDS`, well inside Chrome's 10 MB) and its
errors go into the event's tally (`ddt:<tkey>`), which is kept. Neither names a
player: which seat is yours is worked out from `mh_list` when it is drawn. BBO keeps
these games for years, so a deleted board costs only a solve. Nothing about it
leaves the device.

**Testing: an unpacked build can run an old background.** With `--load-extension`
on an existing profile, Chrome kept running a stale worker after a rebuild, and even
after a version bump. Clear the profile's `Service Worker` folder, or press reload
on `chrome://extensions`, before trusting a storage check.

---

## 4. Authentication summary

| Needs a logged-in session | Works anonymously |
|---|---|
| `live.acbl.org` (403 without) | `webutil.bridgebase.com/v2/tview.php` |
| `my.acbl.org` (403 without) | `www.bridgebase.com/myhands/fetchlin.php` |
| `bridgebase.com/myhands/hands.php` (302 to login) | `www.bridgebase.com/tools/handviewer.html` (deal is in the URL) |
| | `webutil.bridgebase.com/v2/mh_list.php`, `mh_hand.php` (copied, not fetched) |

The split is what makes the replay backfill practical: the extension does the
~3,660 session-bound fetches for a 264-event history in about 20 minutes, and a
CLI does the ~152,000 public ones over days, with no cookies and no browser.

Note the asymmetry within BBO itself. The *content* of a traveller is not
private — it is the whole field's results — but it sits behind `/myhands/` and
redirects without a session. So the field cannot be enumerated without the
user's login, even though every replay it points to is then freely fetchable.

---

## 5. What is deliberately not collected

- **Opponents' real names from BBO.** Available when authenticated; not
  collected, by fetching the summary anonymously (§3.3).
- **BBO handviewer auctions on ACBL Live pages.** Synthetic, not the auction
  played. Extracting them would produce plausible, wrong analysis.
- **Other tables' cardplay during extraction.** Reachable only at ~0.5 req/s, so
  it belongs in the CLI backfill rather than an interactive fetch.
- **Double-dummy from BBO's `dd.php`.** Server-side, ~400 ms per position — see
  [§ 3.7](#37-bbo-double-dummy--ddphp-observed-not-used). Fine as a validation
  oracle, unusable for bulk.
