# Bridge Classroom Fetch — App Store listing

Read by `scripts/app-store-listing.mjs fetch`, which fills in App Store Connect
from it. Each `##` heading is a field; wrapped lines are joined, a blank line
ends a paragraph, and a `• ` line stands on its own. Apple's limits are checked
before anything is sent. The text follows `store/fetch/submission.md`, with no
other browser named: Apple rejects a listing that mentions other platforms.

## Name
Bridge Classroom Fetch

## Subtitle
Bridge results, in one click

## Promotional text
One click sends a whole game, from an ACBL tournament, a club game or Bridge
Base Online, to Bridge Classroom for analysis. No files to download or upload.

## Description
Bridge results are easy to look at and hard to learn from. This extension takes
the game you are already looking at — an ACBL tournament, a club game, or a
Bridge Base Online session — and sends it to Bridge Classroom, where it can be
analysed properly.

Click the button on any supported results page. The extension reads that
game's boards, contracts, scores and comparisons, and opens Bridge Classroom
with them. No downloading files, no uploading them again.

Supported sites:
• live.acbl.org — tournament results
• my.acbl.org — club game results
• Bridge Base Online — tournament results and single deals

On Bridge Base Online it also captures the cardplay for your own table, so your
play can be reviewed hand by hand. Other players' real names are deliberately
not collected from BBO.

The extension only runs on those sites, only when you click it, and sends
results only to Bridge Classroom. No analytics, no tracking, no accounts.

To start, open the app and turn on the extension in Safari, then allow it on
the results sites when Safari asks.

Open source and public domain:
https://github.com/bridge-craftwork/bridge-classroom-fetch

## Keywords
bridge,ACBL,BBO,results,analysis,club,tournament,scores,cardplay,double dummy

## URLs
Support URL: https://github.com/bridge-craftwork/bridge-classroom-fetch/issues
Privacy policy URL: https://bridge-classroom.org/privacy#extension

## Copyright
2026 Bridge Craftwork

## App Review notes (macOS)
No account is needed to test this extension end to end. The test below takes
about a minute and exercises the whole pipeline: injection, extraction, and
hand-off.

First, allow the extension in Safari: Safari > Settings > Extensions, turn on
Bridge Classroom Fetch. Safari then asks per website before any extension may
read a page. Until that is granted, the extension is installed, enabled, and
correctly does nothing, with no error. When the test page below is open, click
the extension's button in the Safari toolbar, choose to always allow it on
every website, and reload the page.

1. Open this URL, a complete bridge deal encoded in the URL itself, needing no
network request and no login:

https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cpc%7CDQ%7Cpc%7CD3%7Cpc%7CD2%7Cpc%7CDK%7Cpc%7CHT%7Cpc%7CH7%7Cpc%7CH2%7Cpc%7CHK%7Cpc%7CST%7Cpc%7CS2%7Cpc%7CS3%7Cpc%7CSK%7Cpc%7CHA%7Cpc%7CH5%7Cpc%7CH6%7Cpc%7CH8%7Cpc%7CHQ%7Cpc%7CS7%7Cpc%7CS4%7Cpc%7CHJ%7Cpc%7CH9%7Cpc%7CS8%7Cpc%7CS5%7Cpc%7CD4%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CS6%7Cpc%7CD6%7Cpc%7CH3%7Cpc%7CSQ%7Cpc%7CSJ%7Cpc%7CD8%7Cpc%7CDA%7Cpc%7CC2%7Cpc%7CD5%7Cpc%7CD9%7Cpc%7CCA%7Cpc%7CC4%7Cpc%7CC6%7Cpc%7CC3%7Cpc%7CCK%7Cpc%7CC7%7Cpc%7CD7%7Cpc%7CC9%7Cpc%7CCQ%7Cpc%7CC8%7Cpc%7CDT%7Cpc%7CCJ%7Cpc%7CC5%7Cpc%7CCT%7Cpc%7CSA%7Cpc%7CDJ%7C

2. A "Bridge Classroom" button appears in BBO's row of controls at the bottom
of the page, beside Rewind / Previous / Next / Options / DD / Play, which are
BBO's own.
3. Click it. A new tab opens at bridge-classroom.org showing the deal's
analysis. No login is requested at any point.

ACBL club results, Bridge Base Online's session pages and ACBL Live
tournaments need a third-party login we cannot supply: BBO allows one active
session per account, and the ACBL login is a personal membership record.
Recordings of these are here:
https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/

## App Review notes (iOS)
No account is needed to test this extension end to end.

On iPhone and iPad, enabling the extension in Settings is not sufficient on its
own. Safari also requires per-website permission before any extension can run
on a page, and until it is granted the extension is installed, enabled, and
correctly does nothing. No error appears, because nothing has run.

To grant it:
1. Open the test URL below in Safari.
2. Open the page menu, the button at the left end of the address bar. On
iPhone the address bar is usually at the BOTTOM of the screen.
3. In that menu, "Bridge Classroom Fetch" appears with a warning indicator
beside it. Tap it and choose to allow it on every website.
4. Reload the page.

A "Bridge Classroom" button then appears in BBO's row of controls at the
bottom of the deal, beside BBO's own Next / Options / DD / Play. Tap it: a new
tab opens at bridge-classroom.org with the deal's analysis. No login is
requested at any point. Safari only injects content scripts into pages loaded
after permission is granted, so the page open at step 3 needs the reload at
step 4.

On iPad, Safari also shows a puzzle-piece extensions button in the toolbar. On
iPhone there is no room for one, and the same controls live in the page menu.

The test URL is a complete bridge deal encoded in the URL itself, needing no
network request and no login:

https://www.bridgebase.com/tools/handviewer.html?bbo=y&lin=pn%7CSouth%2CWest%2CNorth%2CEast%7Cst%7C%7Cmd%7C3S789TQH5KD2C2478T%2CS2456JAH6TD57TKC6%2CS3H78JD4689JQC39J%2C%7Crh%7C%7Cah%7CBoard%201%7Csv%7Co%7Cmb%7Cp%7Cmb%7C2C%7Cmb%7C2S%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7C3H%7Cmb%7Cp%7Cmb%7C3N%7Cmb%7Cp%7Cmb%7Cp%7Cmb%7Cp%7Cpc%7CDQ%7Cpc%7CD3%7Cpc%7CD2%7Cpc%7CDK%7Cpc%7CHT%7Cpc%7CH7%7Cpc%7CH2%7Cpc%7CHK%7Cpc%7CST%7Cpc%7CS2%7Cpc%7CS3%7Cpc%7CSK%7Cpc%7CHA%7Cpc%7CH5%7Cpc%7CH6%7Cpc%7CH8%7Cpc%7CHQ%7Cpc%7CS7%7Cpc%7CS4%7Cpc%7CHJ%7Cpc%7CH9%7Cpc%7CS8%7Cpc%7CS5%7Cpc%7CD4%7Cpc%7CH4%7Cpc%7CS9%7Cpc%7CS6%7Cpc%7CD6%7Cpc%7CH3%7Cpc%7CSQ%7Cpc%7CSJ%7Cpc%7CD8%7Cpc%7CDA%7Cpc%7CC2%7Cpc%7CD5%7Cpc%7CD9%7Cpc%7CCA%7Cpc%7CC4%7Cpc%7CC6%7Cpc%7CC3%7Cpc%7CCK%7Cpc%7CC7%7Cpc%7CD7%7Cpc%7CC9%7Cpc%7CCQ%7Cpc%7CC8%7Cpc%7CDT%7Cpc%7CCJ%7Cpc%7CC5%7Cpc%7CCT%7Cpc%7CSA%7Cpc%7CDJ%7C

ACBL club results, Bridge Base Online's session pages and ACBL Live
tournaments need a third-party login we cannot supply: BBO allows one active
session per account, and the ACBL login is a personal membership record.
Recordings of these are here:
https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/
