# Bridge Craftwork DD — store screenshots

2560×1600 (1280×800 at 2×) here, for the Mac App Store. `listing-1280/` is the
same set at 1280×800 for Chrome, Edge and Firefox, as with Fetch. From event #9428 (ACBL Sun Noon ET Speedball, 22 Nov 2026), retaken for 1.1.0.

| File | Shows |
|---|---|
| `dd-1-event.png` | The board list: me / pd / opp tags, the event totals beside BBO's score; board 1's error cards marked, the double-dummy table (5♥ by North green, par bold) and the result beside BBO's menu |
| `dd-2-menu.png` | BBO's deal menu with "Hide Bridge Craftwork DD" |
| `dd-3-trick.png` | After clicking an error card: its trick on the table (lead, winner, error), the player's alternatives green and red, and Restart in DD Details' place |
| `dd-4-tallies.png` | The list of Recent tournaments, part-way through a run: me-partner-opponents tallies, one event marked * as incomplete, and events not yet reached. **Lead with this one or `dd-1-event.png`.** |

Made with `tools/capture-dd.mjs` against a **copy** of a signed-in Chromium
profile (BBO's `invisible` flag set). The players' names in the deal are blurred
by the script; the account's own username shows in BBO's top bar, as in
Fetch's set. Re-shoot after any visible change to the overlay.

Not shown: live My Table during an event. It needs a game in progress, and the
capture runs on a copy of the profile while nobody is playing.

BBO Helper is not installed in the capture profile, so its par box (top right)
does not appear; with it installed, its table is hidden and its par box stays.
