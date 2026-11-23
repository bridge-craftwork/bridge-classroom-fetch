# Bridge Craftwork DD — App Store listing

Read by `scripts/app-store-listing.mjs dd`, as `fetch.md` is for Fetch. The text
follows `store/dd/submission.md`, with no other browser named.

## Name
Bridge Craftwork DD

## Subtitle
Double-dummy review for BBO

## Promotional text
Double-dummy review of every board you play on Bridge Base Online, right in its
History panel. The solver runs on your Mac; nothing is sent anywhere.

## Description
See where the tricks went. Bridge Craftwork DD adds double-dummy review to the
History panel of Bridge Base Online's web client, right where you already look
back over your boards.

While you play, each board is analysed as it ends: open My Table in BBO's
History and your boards are already tagged. That works for pairs and teams
events, instant tournaments and robot daylongs.

Open an event in BBO's History and, for every board you open:
• The cards that cost a trick are marked in the hands, with the trick they were played to.
• Click one and the viewer steps to that trick. The hand that erred shows what it should have played: the double-dummy best cards in green, the rest in red.
• On the table, the card that led and the card that won each trick are marked, since the hands no longer say who won the trick before.
• A double-dummy table shows what every seat can make in every strain, with the contract played in green and the par contracts in bold. The result at the table sits beside the deal.
• Each board in the list is tagged with the errors by you, your partner and the opponents, or "clean". The event's totals sit beside BBO's own score.
• A DD Details button opens the board in the detailed double-dummy viewer, by way of Bridge Classroom.

On the list of Recent tournaments, each event you have analysed shows its tally
as me-partner-opponents, so you can see how your results line up with the
errors on each side, including the event you have just played. A * means some
of its boards are still to do. DD all fills in a whole event, and the DD menu
fills in today, the last 7 or 30 days, or everything listed.

The double-dummy solver runs inside the extension, on your Mac. Nothing is sent
to a server for analysis. Boards are read from what BBO's own page has already
received, in History or at the table. Only DD all asks BBO for anything: it
requests the boards from BBO's public History pages, one a second, without your
login. Analyses stay on your Mac, so going back to an event is instant.

Hide or show it any time from the menu on BBO's deal view.

To start, open the app and turn on the extension in Safari, then allow it on
www.bridgebase.com and bridge-classroom.org when Safari asks.

No analytics, no tracking, no accounts. Open source.

## Keywords
bridge,double dummy,BBO,analysis,cardplay,declarer,defense,par,tricks,review

## URLs
Support URL: https://github.com/bridge-craftwork/bridge-classroom-fetch/issues
Privacy policy URL: https://bridge-craftwork.com/dd/privacy/

## Copyright
2026 Bridge Craftwork

## App Review notes (macOS)
In Safari, after enabling the extension in Safari > Settings > Extensions, also
allow it on two websites, using the extension's button in the toolbar on each:
www.bridgebase.com, where the review is drawn, and bridge-classroom.org, which
receives a board when you click DD Details. Safari asks per website. Until it
is granted on www.bridgebase.com, nothing appears, with no error. Until it is
granted on bridge-classroom.org, DD Details opens a page saying the extension
did not respond; allow it there and reload that page, and the board arrives.

This extension works inside Bridge Base Online's History panel, which requires
a signed-in BBO account with played boards. We cannot supply one: BBO allows
only one active session per account, so a shared login would sign reviewers out
of one another, and a newly created account has no History to review.

A short recording of the whole extension in use, on a real BBO account, is here:
https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/dd/bridge-craftwork-dd.mp4

To see it with your own account, if you have one with recent tournament play:
1. Sign in at https://www.bridgebase.com/v3/ and open the History tab on the right.
2. Open Recent tournaments, then any event. Boards that have errors get a tag in the Result column; checked boards with none say "clean".
3. The board shown below has its error cards marked in the hands. Click one: the viewer steps to that trick, and the player who erred has their alternatives marked green (best) and red.
4. The menu button (three lines) on the board has "Hide Bridge Craftwork DD", which removes everything; "Show" brings it back.
5. DD Details opens the board on bridge-classroom.org, which passes it to the viewer at bridge-craftwork.com/bridge-solver.
6. "DD all" above Results analyses the whole event. On the Recent tournaments list, the last column is headed DD: analysed events show errors as me-partner-opponents, and its menu runs a date range.

The solver runs locally (bundled WebAssembly). The only requests the extension
makes are DD all's, to BBO's public History endpoints, one a second and without
cookies.
