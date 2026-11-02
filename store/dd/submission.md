# Bridge Craftwork DD — submission answers, paste-ready

Version **1.0.0**. Chrome, Edge, Firefox (addons.mozilla.org) and the Mac App
Store. Built with `EXT=dd scripts/package-stores.sh`, which writes
`dist/packages/bridge-craftwork-dd-1.0.0-{chrome,edge,firefox,source}.zip` and
refreshes the Xcode project in `safari-dd/`.

Modelled on Fetch's [docs/submission-answers.md](../../docs/submission-answers.md),
which has been through review once; where this differs, it says why.

**Before submitting, see [Blockers](#blockers) at the end.**

---

## Store listing

**Name**

```
Bridge Craftwork DD
```

**Short summary / subtitle** — 130 chars, inside Chrome's 132 limit. The same
text is the manifest description; `package-stores.sh` refuses a longer one.

```
Double-dummy review in Bridge Base Online's History panel: every card that cost a trick, and what should have been played instead.
```

**Description**

```
See where the tricks went. Bridge Craftwork DD adds double-dummy review to the History panel of Bridge Base Online's web client, right where you already look back over your boards.

Open an event in BBO's History and, for every board you open:
• The cards that cost a trick are marked in the hands, with the trick they were played to.
• Click one and the viewer steps to that trick. The hand that erred shows what it should have played: the double-dummy best cards in green, the rest in red.
• On the table, the card that led and the card that won each trick are marked, since the hands no longer say who won the trick before.
• Each board in the list is tagged with the errors by you, your partner and the opponents, or "clean". The event's totals sit beside BBO's own score.
• A DD Details button opens the board in Bridge Classroom's detailed double-dummy view.

The double-dummy solver runs inside the extension, on your device. Nothing is sent to a server for analysis, and the extension makes no requests of its own to Bridge Base: it reads the boards BBO's own History panel has already loaded. Analyses are kept on your device for 14 days, so going back to an event is instant.

Hide or show it any time from the menu on BBO's deal view.

No analytics, no tracking, no accounts. Open source.
```

**Category** — Productivity (Chrome, Edge) · Other (Firefox) · Utilities (Mac
App Store), as Fetch.

**Privacy policy URL**

```
https://bridge-craftwork.com/dd/privacy/
```

**Homepage / support URL**

```
https://github.com/bridge-craftwork/bridge-classroom-fetch
```

---

## Single purpose

```
Show a double-dummy review of the boards the user opens in Bridge Base Online's History panel.
```

---

## Permission justifications

**storage**

```
Keeps the double-dummy analysis of each board the user opens for 14 days, on the user's device, so returning to an event does not repeat the work, and remembers whether the user has hidden the display. Nothing is transmitted anywhere.
```

**scripting**

```
Registers one small script on www.bridgebase.com/v3/ that runs in the page's own context, because only there can it see the History panel's data. When BBO's own page loads an event's board list or a board's play from its own server, the script passes a copy of that response to the extension. It makes no requests of its own, changes nothing BBO receives, and ignores every other request. Its one other job: while the user's click is stepping BBO's viewer to a particular trick, it shortens BBO's card-animation delays so the step takes a moment instead of two seconds a trick, and restores them when the step ends (or after 15 seconds at most). It is registered with scripting.registerContentScripts rather than declared in the manifest so the browser injects it directly.
```

**Host permissions** — one host.

```
www.bridgebase.com/v3/ — Bridge Base Online's web client, whose History panel the review is drawn on. No other origin is requested. The extension sends nothing anywhere unless the user clicks its DD Details button, which opens the board on bridge-classroom.org.
```

**Content script on `bridge-classroom.org` / `.com`** — no host permission is
requested; the match is for the hand-off page alone. If a field asks:

```
Delivers the one board the user chose with DD Details to the Bridge Classroom page that opens, which shows its detailed analysis. Runs only on that page.
```

**Remote code** — answer **No**.

```
No remote code. The double-dummy solver is WebAssembly bundled in the package (assets/bridge_solver_wasm_bg-*.wasm, from the open-source bridge-solver project, MIT licence) and compiled locally. That is why the manifest's extension_pages content security policy includes 'wasm-unsafe-eval': it permits WebAssembly compilation only, not eval, and only of files inside the package.
```

---

## Data use

**Collected** — tick **Website content** and **Personally identifiable
information**, as Fetch does, and for the same reason: "collect" in every
store's sense means *leaves the device*. One path does. DD Details sends the
board, its play and the four players' **BBO usernames** to bridge-classroom.org.
A username identifies a person. Everything else stays on the device.

Firefox's manifest already declares `personallyIdentifyingInfo` and
`websiteContent` (`vite.config.js`), so the two stores agree.

Not ticked: Health, Financial, Authentication (never reads credentials),
Personal communications, Location, Web history, User activity. As Fetch.

**Certifications** — all three can be affirmed: not sold; not used for
unrelated purposes; not used for creditworthiness or lending.

**If a free-text field is offered**

```
The extension analyses, on the user's device, the bridge boards the user opens in Bridge Base Online's History panel, from the copy of that data BBO's own page has already loaded. The analysis and the boards are kept in extension storage on the device for 14 days. Nothing leaves the device unless the user clicks DD Details on a board, which opens that one board, with the players' BBO usernames, on bridge-classroom.org. No analytics, no telemetry, no third-party endpoint.
```

---

## Notes for reviewers

Paste for Firefox and Apple; Chrome has per-permission fields only.

```
This extension works inside Bridge Base Online's History panel, which requires a signed-in BBO account with played boards. We cannot supply one: BBO allows only one active session per account, so a shared login would sign reviewers out of one another, and a newly created account has no History to review.

A short recording of the whole extension in use, on a real BBO account, is here:
[RECORDING URL — see Blockers]

To see it with your own account, if you have one with recent tournament play:
1. Sign in at https://www.bridgebase.com/v3/ and open the History tab on the right.
2. Open Recent tournaments, then any event. Boards that have errors get a tag in the Result column; checked boards with none say "clean".
3. The board shown below has its error cards marked in the hands. Click one: the viewer steps to that trick, and the player who erred has their alternatives marked green (best) and red.
4. The menu button (three lines) on the board has "Hide Bridge Craftwork DD", which removes everything; "Show" brings it back.
5. DD Details opens the board on bridge-classroom.org.

The solver runs locally (bundled WebAssembly). The extension makes no network requests of its own to Bridge Base.
```

**Apple: add this.** As with Fetch, a reviewer who skips it sees nothing. The
second site is easy to miss: on a real Mac, 2 Nov 2026, DD Details failed with
"The extension did not respond" while everything on BBO worked.



```
In Safari, after enabling the extension in Settings > Extensions, also allow it on two websites, using the extension's button in the toolbar on each: www.bridgebase.com, where the review is drawn, and bridge-classroom.org, which receives a board when you click DD Details. Safari asks per website. Until it is granted on www.bridgebase.com, nothing appears, with no error. Until it is granted on bridge-classroom.org, DD Details opens a page saying the extension did not respond; allow it there and reload that page, and the board arrives.
```

---

## Release notes — 1.0.0

```
First release: double-dummy review in Bridge Base Online's History panel. Error cards marked in the hands; click to step to the trick and see the alternatives; lead and winner marked on the table; per-board tags and event totals for you, partner and opponents; Show/Hide from BBO's deal menu; DD Details opens the board in Bridge Classroom.
```

---

## Assets

| | |
|---|---|
| Icon | `icons-dd/icon-128.png`; Edge's 300×300 store logo is `icons-dd/icon-300.png` |
| Mac app icon | rendered into the Xcode project's asset catalog by `node scripts/render-icons.mjs --ext dd` |
| Screenshots | `store/dd/screenshots/`, 1280×800 (Chrome, Edge, Firefox); see that folder's README |
| Privacy page | live at https://bridge-craftwork.com/dd/privacy/, from `bridge-craftwork-site/site/dd/privacy/index.html` (copy of `store/dd/privacy-page.html`) |

---

## Blockers

Things only Rick can do, in the order they block:

1. ~~Approve the icon~~ — **approved**, 2 Nov 2026 (`icons-dd/`: Fetch's
   mortarboard with a red DD badge).
2. ~~Publish the privacy page~~ — **done**, live at
   <https://bridge-craftwork.com/dd/privacy/> (bridge-craftwork-site#12,
   2 Nov 2026).
3. ~~Test in Safari on a Mac~~ — **passed**, 2 Nov 2026 (Rick). The hand
   diagram needed a fix first (`75f8ea2`), and DD Details needs the
   per-website permission on bridge-classroom.org, as the Apple notes say.
4. ~~Test in Firefox~~ — **passed**, 2 Nov 2026 (Rick, temporary add-on,
   including the fast trick jumps).
5. **Record the reviewer demo** and put the URL in the reviewer notes. Fetch's
   recordings live at bridge-craftwork.github.io/bridge-classroom-fetch/demo/.
   Other players' usernames must be blurred, as there.
6. **Mac App Store**: create the app record for bundle id
   `org.bridge-classroom.bridge-craftwork-dd` (team 8H3FX5B8KD). The bundle id
   is permanent once created; change it in `project.pbxproj` first if needed.
