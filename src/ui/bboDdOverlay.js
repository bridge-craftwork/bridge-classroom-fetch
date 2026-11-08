// Per-card double-dummy drawn into the BBO v3 History panel.
//
//   • the open board: each played card gets the number of the trick it went to,
//     and a card that cost its side a trick is marked in red
//   • the board list: a small chip per board counting double-dummy errors by
//     you, your partner and the opponents
//   • a button under BBO's own deal menu that sends the board to Bridge
//     Classroom
//
// Opening boards fetches nothing. The page hook (public-dd/bbo-page-hook.js)
// passes on copies of what BBO's History panel itself loads — tfind.php for the
// list of events, mh_list.php when an event opens, mh_hand.php for each board
// shown — and the background solves each board once, in WASM, and caches it. Going
// back to an event later redraws from the cache. The one thing that asks BBO for
// anything is DD-all (src/lib/ddBatch.js), when the user chooses it.
//
// BBO's markup is a production Angular build: custom elements, inline absolute
// positioning, no stable ids. Everything below is located by element name and
// checked before use, and a board is drawn only when the panels on screen
// demonstrably hold the deal we analysed. A mismatch draws nothing rather than
// something wrong.

import { parseMhList, parseMhHand, parseTfind } from '../adapters/bbo/parsers/mhXml.js'
import { parseArdDeals, parseBoardDetails, resultOfLin } from '../adapters/bbo/parsers/liveXml.js'
import { parseLin, parseLinPlayers } from '../adapters/bbo/parsers/lin.js'
import { summarizeTrace, seatOf, hasRobotPartner, solverCard, trumpOf } from '../lib/ddPlay.js'
import {
  analyzeEvents,
  eventsToRun,
  fetchBoard,
  fetchEventList,
  isComplete,
} from '../lib/ddBatch.js'
import {
  clearHistory,
  closeMenu,
  drawTallies,
  menuRanges,
  MENU_ID,
  openMenu,
  syncEventButton,
  syncHeader,
} from './ddHistory.js'

const TAG = 'bridge-classroom-bbo'
const BADGE_CLASS = 'bc-dd-trick'
const PILL_CLASS = 'bc-dd-cost'
const CHEVRON_CLASS = 'bc-dd-lead'
const CHIP_CLASS = 'bc-dd-chip'
const TOTALS_CLASS = 'bc-dd-totals'
export const POPOUT_ID = 'bridge-classroom-dd-popout'
export const RESTART_ID = 'bridge-classroom-dd-restart'

const SUIT_BY_SYMBOL = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }
const ERROR_FG = 'rgb(200, 0, 0)'
// The bridge-solver site's play-table convention (web/src/components/
// PlayTrace.vue there), so a board reads the same in both places.
const COST_CHIP = 'rgba(216, 72, 72, 0.28)' // --cost-mild
const COST_BAD = '#c62828' // declarer lost a trick
const COST_GOOD = '#1d7a3f' // the defence gave one back
const LEAD_BG = '#e8eef5'
const LEAD_BAR = '#5b86b5'
const WON_BG = '#d4edda' // --green-pale
const ALT_GOOD = 'rgba(46, 160, 67, 0.34)' // --alt-good
const ALT_BAD = 'rgba(216, 72, 72, 0.34)' // --alt-bad
// Partner in orange, not your red: whose error it was should read at a
// glance. Darker than a pure orange so 13px type holds up on white.
const PD_FG = 'rgb(205, 100, 0)'
const OPP_FG = 'rgb(0, 130, 40)'
const MUTED_FG = 'rgb(110, 110, 110)'

// On screen, by whether it has a layout box. BBO's deal-viewer and hand panels
// are custom elements holding only absolutely positioned children, which leaves
// the element itself with no box of its own in some engines, so its children
// are asked too. A hidden ancestor (BBO's second, undisplayed viewer) leaves
// them all without boxes, which is still read correctly as hidden.
const defaultVisible = (el) =>
  !!el &&
  (el.getClientRects().length > 0 ||
    [...el.children].some((child) => child.getClientRects().length > 0))

// The suit in a symbol's text. Apple platforms draw bare suit characters as
// emoji, so a page may add a variation selector (U+FE0E) after them: an exact
// match on the text would miss it.
const suitIn = (text) => SUIT_BY_SYMBOL[/[♠♥♦♣]/u.exec(String(text ?? ''))?.[0]]

// ── Reading BBO's hand diagram ───────────────────────────────────────────────

/** "K" / "10" / " 7\n" → the solver's rank character, or null. */
export function rankOf(text) {
  const t = String(text ?? '').trim()
  if (t === '10' || t === 'T') return 'T'
  return /^[2-9AKQJ]$/.test(t) ? t : null
}

/** The cards in one hand-diagram-panel: [{ el, code }], code as the solver
 *  writes it ("SK", "HT"). Suits are matched row to symbol by vertical
 *  position, the only thing that ties them together in BBO's markup. Returns
 *  null when the panel is not the shape expected. */
export function readPanel(panel) {
  const symbols = new Map()
  for (const sym of panel.querySelectorAll('.suitSymbolClass')) {
    const suit = suitIn(sym.textContent)
    if (suit) symbols.set(sym.style.top, suit)
  }
  if (symbols.size !== 4) return null
  const cards = []
  for (const row of panel.querySelectorAll('.suitPanelClass')) {
    const suit = symbols.get(row.style.top)
    if (!suit) return null
    for (const card of row.querySelectorAll('hand-diagram-card')) {
      const face = card.querySelector('.handDiagramCardClass') ?? card
      const rank = rankOf(firstText(face))
      if (!rank) return null
      cards.push({ el: face, code: suit + rank })
    }
  }
  return cards
}

// The rank is the face's own text; our badge, once added, is a child element
// and must not be read back as part of it.
function firstText(el) {
  let s = ''
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent
  return s
}

/** The visible hands of the viewer showing `deal` (parseLin's deal), each tied
 *  to its seat. Returns { viewer, hands: [{ seat, cards }] }, or null unless every
 *  visible card in some viewer sits in the hand the LIN gives it — the check that
 *  we are drawing on the board we solved.
 *
 *  Every visible viewer is tried: a player seated at a table has two on screen,
 *  the table's and History's, and the table's comes first (seen 6 Nov 2026).
 *  When more than one fits, the last wins, which is History's: a board just
 *  finished stays at the table, as its last few cards or as the whole deal for
 *  review, and fits too. Counting cards does not tell them apart, since History
 *  shows fewer once the player steps into the play (seen 8 Nov 2026). */
export function matchPanels(doc, deal, isVisible = defaultVisible) {
  const seatOfCard = {}
  for (const seat of ['N', 'E', 'S', 'W']) {
    for (const suit of ['S', 'H', 'D', 'C']) {
      for (const r of deal[seat][suit]) seatOfCard[solverCard(suit + r)] = seat
    }
  }
  let last = null
  for (const viewer of doc.querySelectorAll('deal-viewer')) {
    if (!isVisible(viewer)) continue
    const hands = viewerHands(viewer, seatOfCard, isVisible)
    if (hands) last = { viewer, hands }
  }
  return last
}

function viewerHands(viewer, seatOfCard, isVisible) {
  const out = []
  for (const panel of viewer.querySelectorAll('hand-diagram-panel')) {
    if (!isVisible(panel)) continue
    const cards = readPanel(panel)
    if (!cards) return null
    if (!cards.length) continue
    const seats = new Set(cards.map((c) => seatOfCard[c.code]))
    if (seats.size !== 1 || seats.has(undefined)) return null
    out.push({ seat: [...seats][0], cards })
  }
  return out.length ? out : null
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Mark every played card with its trick, and the costly ones in red.
 *  Idempotent: a card already showing the right mark is left alone, so the
 *  mutation observer that calls this does not feed on its own output. */
export function drawDeal(hands, summary, doc, alternatives = null) {
  for (const { seat, cards } of hands) {
    const alts = alternatives?.[seat] ?? null
    for (const { el, code } of cards) {
      const mark = alts?.[code] ? altMark(alts[code]) : errorMark(summary?.cards[code], doc)
      const want = mark?.key ?? ''
      if ((el.dataset.bcDdMark ?? '') === want) continue
      unmarkCard(el)
      if (!mark) continue
      el.dataset.bcDdMark = want
      el.dataset.bcDdStyle = el.style.cssText
      mark.apply(el, doc)
    }
  }
}

function unmarkCard(el) {
  for (const added of el.querySelectorAll(`.${BADGE_CLASS}, .${PILL_CLASS}`)) added.remove()
  if (el.dataset.bcDdStyle !== undefined) el.style.cssText = el.dataset.bcDdStyle
  delete el.dataset.bcDd
  delete el.dataset.bcDdMark
  delete el.dataset.bcDdStyle
  el.removeAttribute('title')
}

// Errors only. Every card's trick is known, but numbering all 52 makes a
// diagram nobody can read at a glance; the errors are what to look at.
function errorMark(played) {
  if (!(played?.cost > 0)) return null
  const info = played
  return {
    key: `error:${info.trick}:${info.cost}:${info.signed}`,
    apply(el, doc) {
      // The trick, read by the click handler that steps the viewer to it.
      el.dataset.bcDd = `${info.trick}:${info.cost}`
      // Which trick, as "T4": here, unlike the site's trick table, no row says
      // it, and a bare number beside a card reads as part of the card. The
      // signed badge is kept for errors that cost more than one trick; one is
      // the usual case, and the chip alone says it.
      el.append(cardLabel(doc, `T${info.trick}`, 'rgb(85, 85, 85)'))
      if (Math.abs(info.signed) > 1) el.append(costPill(doc, info.signed))
      Object.assign(el.style, {
        backgroundColor: COST_CHIP,
        borderRadius: '4px',
        cursor: 'pointer',
      })
      el.title = `${costText(info.signed)} — trick ${info.trick}. Click to go to the trick.`
    },
  }
}

// What the player who erred could have played instead, shown in their hand
// while the trick with the error is on the table: the bridge-solver site's
// node colours — green for double-dummy best, red otherwise.
function altMark({ good, cost }) {
  return {
    key: `alt:${good ? 'good' : cost}`,
    apply(el, doc) {
      // No count on the red ones: what matters is finding the green card, and
      // the obviously bad choices would always carry the biggest numbers. The
      // tooltip still says how many.
      Object.assign(el.style, { backgroundColor: good ? ALT_GOOD : ALT_BAD, borderRadius: '4px' })
      el.title = good
        ? 'Would have been double-dummy best here'
        : `Would also have lost ${cost} trick${cost === 1 ? '' : 's'}`
    },
  }
}

function cardLabel(doc, text, color) {
  const label = doc.createElement('span')
  label.className = BADGE_CLASS
  label.textContent = text
  Object.assign(label.style, {
    fontSize: '0.7em',
    // BBO's card text ends in whitespace (" 4\n"), which renders as a full
    // space before this label. Pulled back over it, so the label sits against
    // the rank; the smaller type and the shared chip group them.
    margin: '0 1px 0 -0.3em',
    fontWeight: '600',
    color,
  })
  return label
}

/** For each error in the trick on the table, the alternatives at it, keyed by
 *  seat and card: { [seat]: { [card]: { good, cost } } }. `nodes` maps a play
 *  index to dd_play_node's answer. The card actually played is on the table,
 *  not in the hand, so it is left out. */
export function alternativesForTrick(summaryTrace, showing, nodes) {
  const out = {}
  for (const t of summaryTrace) {
    if (Math.floor(t.index / 4) + 1 !== showing || !(t.cost > 0)) continue
    const node = nodes.get(t.index)
    if (!node?.alternatives) continue
    const best = Math.min(...node.alternatives.map((a) => a.cost))
    const cards = {}
    for (const alt of node.alternatives) {
      if (alt.card === t.card) continue
      cards[alt.card] = { good: alt.cost === best, cost: alt.cost - best }
    }
    out[t.seat] = cards
  }
  return out
}

/** The round signed badge: "−1" red when the declaring side gave a trick away,
 *  "+1" green when the defence handed one back. */
function costPill(doc, signed) {
  const pill = doc.createElement('span')
  pill.className = PILL_CLASS
  pill.textContent = signed > 0 ? `+${signed}` : `−${-signed}`
  Object.assign(pill.style, {
    display: 'inline-block',
    marginLeft: '2px',
    padding: '0 0.35em',
    minWidth: '1.6em',
    height: '1.6em',
    lineHeight: '1.6em',
    boxSizing: 'border-box',
    borderRadius: '999px',
    background: signed > 0 ? COST_GOOD : COST_BAD,
    color: '#fff',
    font: '700 0.42em sans-serif',
    textAlign: 'center',
    verticalAlign: 'middle',
  })
  return pill
}

function costText(signed) {
  const n = Math.abs(signed)
  const tricks = `${n} trick${n === 1 ? '' : 's'}`
  return signed > 0 ? `Defence gave back ${tricks}` : `Declarer's side lost ${tricks}`
}

const SYMBOL_SUIT = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }

/** Cards still in the four visible hands. 52 less this is how far the play
 *  has got, which is the only reliable reading of BBO's position. */
export function cardsInHands(viewer, isVisible = defaultVisible) {
  let n = 0
  for (const panel of viewer.querySelectorAll('hand-diagram-panel')) {
    if (isVisible(panel)) n += panel.querySelectorAll('hand-diagram-card').length
  }
  return n
}

/** Cards played so far, as far as the hands show. */
export function cardsPlayed(viewer, isVisible = defaultVisible) {
  return 52 - cardsInHands(viewer, isVisible)
}

/** Mark the four cards on the table while their trick is showing, as the
 *  bridge-solver site's play table does: the card that led tinted blue with a
 *  bar and chevron down its left edge, the card that won tinted green, and an
 *  error as a chip with its signed badge. A card that led and won keeps both —
 *  green, with the bar — since whoever wins leads next and that is common.
 *
 *  BBO keeps the four table elements in place before the play starts too, so
 *  the trick on screen is worked out from what has left the hands, not from
 *  what the table appears to hold. */
export function drawTable(viewer, summary, isVisible = defaultVisible) {
  const played = cardsPlayed(viewer, isVisible)
  const showing = played > 0 ? Math.ceil(played / 4) : 0
  const complete = played > 0 && played % 4 === 0
  const doc = viewer.ownerDocument
  for (const card of viewer.querySelectorAll('.handDiagramCurrentTrickClass')) {
    const text = card.textContent.replace(/[\s+−-]\d*$/u, '').replace(/[\s\uFE0E\uFE0F]+/gu, '')
    const suit = SYMBOL_SUIT[text[0]]
    const rank = rankOf(text.slice(1))
    const info = suit && rank ? summary?.cards[suit + rank] : null
    const here = info && info.trick === showing
    const flags = {
      lead: !!(here && info.lead),
      won: !!(here && complete && info.won),
      error: !!(here && info.cost > 0),
    }
    const want = Object.keys(flags)
      .filter((k) => flags[k])
      .join(' ')
    if ((card.dataset.bcDdTable ?? '') === want) continue
    restoreTableCard(card)
    if (!want) continue
    card.dataset.bcDdTable = want
    card.dataset.bcDdTableStyle = card.style.cssText
    if (flags.lead) {
      card.style.backgroundColor = LEAD_BG
      card.style.boxShadow = `inset 3px 0 0 ${LEAD_BAR}`
      const chevron = doc.createElement('span')
      chevron.className = CHEVRON_CLASS
      Object.assign(chevron.style, {
        position: 'absolute',
        left: '3px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '4.5px',
        height: '14px',
        background: LEAD_BAR,
        clipPath: 'polygon(0 0, 0 100%, 100% 50%)',
        pointerEvents: 'none',
      })
      card.appendChild(chevron)
    }
    if (flags.won) card.style.backgroundColor = WON_BG
    if (flags.error) {
      const face = card.querySelector('.innerDivClass') ?? card
      face.dataset.bcDdTableFace = face.style.cssText
      Object.assign(face.style, { backgroundColor: COST_CHIP, borderRadius: '4px' })
    }
    if (flags.error && Math.abs(info.signed) > 1) {
      // On the table the badge is pinned inside the card's right edge, not laid
      // out beside the rank: BBO's table cards are a fixed height that clips
      // overflow, so anything in the flow wraps out of sight, and anything
      // outside the edge is cut off. The rank is centred, so the right side
      // has room.
      const pill = costPill(doc, info.signed)
      Object.assign(pill.style, {
        position: 'absolute',
        top: '50%',
        right: '3px',
        transform: 'translateY(-50%)',
        margin: '0',
        fontSize: '12px',
        zIndex: '1',
      })
      card.appendChild(pill)
      // BBO positions the rank absolutely in the card, so a margin on the right
      // does nothing; one on the left moves it over to clear the badge.
      ;(card.querySelector('.innerDivClass') ?? card).style.marginLeft = '-10px'
    }
    card.title = [
      flags.lead && 'Led',
      flags.won && 'Won the trick',
      flags.error && costText(info.signed),
    ]
      .filter(Boolean)
      .join(' · ')
  }
}

function restoreTableCard(card) {
  if (card.dataset.bcDdTable === undefined) return
  for (const added of card.querySelectorAll(`.${CHEVRON_CLASS}, .${PILL_CLASS}`)) added.remove()
  const face = card.querySelector('[data-bc-dd-table-face]')
  if (face) {
    face.style.cssText = face.dataset.bcDdTableFace
    delete face.dataset.bcDdTableFace
  }
  card.style.cssText = card.dataset.bcDdTableStyle ?? card.style.cssText
  delete card.dataset.bcDdTable
  delete card.dataset.bcDdTableStyle
  card.removeAttribute('title')
}

/** BBO's own Previous trick / Next trick buttons, or null. With `viewer`, the
 *  pair nearest it: they sit outside the viewer, and a player seated at a table
 *  has a second viewer on screen. */
export function trickButtons(doc, isVisible = defaultVisible, viewer = null) {
  const pair = (root) => {
    const find = (label) =>
      [...root.querySelectorAll('button')].find(
        (b) => isVisible(b) && b.textContent.trim() === label
      ) ?? null
    const prev = find('Previous trick')
    const next = find('Next trick')
    return prev && next ? { prev, next } : null
  }
  for (let el = viewer?.parentElement; el; el = el.parentElement) {
    const found = pair(el)
    if (found) return found
  }
  return pair(doc)
}

/** Step BBO's viewer to the end of trick `trick`, by pressing its own buttons.
 *
 *  From wherever it is now: Previous trick to go back (instant), Next trick to
 *  go forward. Each Next animates its trick a card at a time, about a second
 *  and a half, so starting from the current position rather than from the
 *  beginning is what keeps a jump short. One press per trick, waiting for the
 *  hands to show it finished: pressing again mid-animation does something, but
 *  not reliably the same thing, so it is not relied on.
 *
 *  Position is read from the cards left in the hands, never inferred from the
 *  clicks. `cards()` counts them; `sleep(ms)` waits. Resolves to the trick
 *  reached. */
export async function stepToTrick({ prev, next, cards, sleep, trick }) {
  const waitFor = async (ok, ms) => {
    for (let t = 0; t < ms; t += 50) {
      if (ok()) return true
      await sleep(50)
    }
    return ok()
  }
  const done = () => Math.floor((52 - cards()) / 4)

  // Mid-trick (an animation still running): let it land first.
  await waitFor(() => (52 - cards()) % 4 === 0 || next.disabled, 3000)

  for (let guard = 0; done() > trick && guard < 14 && !prev.disabled; guard++) {
    const before = cards()
    prev.click()
    await waitFor(() => cards() !== before, 1500)
  }
  for (let guard = 0; done() < trick && guard < 14 && !next.disabled; guard++) {
    const target = 52 - 4 * (done() + 1)
    next.click()
    // A claimed board ends part-way through a trick; that is as far as it goes.
    if (!(await waitFor(() => cards() <= target || next.disabled, 4000))) break
  }
  return done()
}

/** Remove every mark we made in the deal viewer. */
export function clearDeal(doc) {
  for (const card of doc.querySelectorAll('[data-bc-dd-table]')) restoreTableCard(card)
  for (const el of doc.querySelectorAll('[data-bc-dd-mark]')) unmarkCard(el)
}

/** Remove everything the overlay draws: deal, table, board tags, totals and
 *  its buttons. */
export function clearAll(doc) {
  clearDeal(doc)
  for (const el of doc.querySelectorAll(`.${CHIP_CLASS}, .${TOTALS_CLASS}`)) el.remove()
  syncPopout(doc, null)
  syncRestart(doc, null)
  clearHistory(doc)
}

/** What the board list shows for one analysed board.
 *
 *  { clean: true, title } when nobody erred — distinct from a board not yet
 *  analysed, which shows nothing — or { lines: [{ label, n, color }], title }:
 *  a line each for me / pd / opp, only for those who erred: me red, partner
 *  orange, opponents green since their errors are your gain. A
 *  board the user only watched has no "me", so it gets one line. */
export function chipFor(counts, totalErrors) {
  const tricks = (n) => `${n} trick${n === 1 ? '' : 's'}`
  if (!counts) {
    if (totalErrors === 0) return { clean: true, title: 'Double-dummy: no errors' }
    return {
      lines: [{ label: 'DD', n: totalErrors, color: ERROR_FG }],
      title: `${totalErrors} double-dummy error${totalErrors === 1 ? '' : 's'}`,
    }
  }
  const { me, partner, opps } = counts
  if (me.errors + partner.errors + opps.errors === 0) {
    return { clean: true, title: 'Double-dummy: no errors by anyone' }
  }
  const long = (label, c) =>
    c.dummy ? `${label}: dummy` : `${label}: ${c.errors}${c.errors ? ` (${tricks(c.tricks)})` : ''}`
  return {
    // Only who erred: a zero line is noise, and leaving zeros out also means
    // dummy needs no special case — dummy's cards are charged to declarer.
    lines: [
      { label: 'me', n: me.errors, color: ERROR_FG },
      { label: 'pd', n: partner.errors, color: PD_FG },
      { label: 'opp', n: opps.errors, color: OPP_FG },
    ].filter((l) => l.n > 0),
    title: `Double-dummy errors — ${long('you', me)}, ${long('partner', partner)}, ${long('opponents', opps)}`,
  }
}

function chipKey(chip) {
  return chip.clean ? 'clean' : chip.lines.map((l) => `${l.label}${l.n}`).join(' ')
}

// The visible height of a board row: BBO sets it inline on the row's
// rectangle. Falls back to the cell's own height if that ever goes.
function rowHeight(row, cell) {
  const h = Number.parseFloat(row.querySelector('celled-rectangle')?.style.height)
  return Number.isFinite(h) && h > 0 ? h : cell.clientHeight || 46
}

// A result as BBO writes it in mh_list ("4HW=", "3NS+2") and as the list on
// screen shows it ("4♥W=", "3NTS+2"), brought to one form. A passed-out board
// is "P" in a daylong's ard.php and "Pass" on screen.
const resultKey = (text) =>
  String(text ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace('NT', 'N')
    .replace('♠', 'S')
    .replace('♥', 'H')
    .replace('♦', 'D')
    .replace('♣', 'C')
    .replace(/^PASS$/, 'P')

/** Whether the visible board list is `list`: every row's board is in it, and
 *  the results agree. BBO draws My Table, Recent tournaments' events and others
 *  in the same component, and My Table is filled over the game connection,
 *  not by a list we see, so the last list loaded may belong to another event
 *  entirely (seen 6 Nov 2026). A board still being played shows no result on
 *  screen, which counts as disagreeing.
 *
 *  One disagreement in ten is let through: the two spellings have only been
 *  compared for ordinary contracts, and a passed-out board, say, may be
 *  written differently. Another event's list disagrees on nearly every row. */
export function listOnScreen(doc, list, isVisible = defaultVisible, { partial = false } = {}) {
  if (!list) return false
  const byNumber = new Map(list.boards.map((b) => [b.number, b]))
  let compared = 0
  let agreed = 0
  for (const row of doc.querySelectorAll('result-list-item')) {
    if (!isVisible(row)) continue
    const cells = row.querySelectorAll('.cellClass')
    if (cells.length < 2) continue
    const number = Number.parseInt(cells[0].textContent.trim(), 10)
    if (!Number.isInteger(number)) continue
    const board = byNumber.get(number)
    if (!board) {
      // My Table's list is built a board at a time, as each is opened.
      if (partial) continue
      return false
    }
    if (!board.result) continue
    const inner = cells[1].querySelector('.innerClass') ?? cells[1]
    compared++
    if (resultKey(inner.textContent) === resultKey(board.result)) agreed++
  }
  return compared > 0 && agreed >= compared * 0.9
}

/** One tag per analysed board in the visible board list, at the right of the
 *  Result cell. */
export function drawIndex(doc, list, entries, username, isVisible = defaultVisible) {
  const byNumber = new Map(list.boards.map((b) => [b.number, b]))
  for (const row of doc.querySelectorAll('result-list-item')) {
    if (!isVisible(row)) continue
    const cells = row.querySelectorAll('.cellClass')
    if (cells.length < 2) continue
    const number = Number.parseInt(cells[0].textContent.trim(), 10)
    const board = byNumber.get(number)
    const entry = board && entries.get(board.resultkey)
    let chip = null
    if (entry?.contract) {
      const mySeat = board.mySeat ?? seatOf(board.players, username)
      const { counts } = summarizeTrace(entry.trace, {
        declarer: entry.declarer,
        mySeat,
        robotPartner: board.robotPartner ?? hasRobotPartner(board.players, mySeat),
      })
      chip = chipFor(counts, entry.trace.filter((t) => t.cost > 0).length)
    }
    const cell = cells[1]
    const existing = cell.querySelector(`.${CHIP_CLASS}`)
    if (!chip) {
      existing?.remove()
      continue
    }
    const key = chipKey(chip)
    if (existing?.dataset.bcDdChip === key) continue
    existing?.remove()

    const el = doc.createElement('div')
    el.className = CHIP_CLASS
    el.dataset.bcDdChip = key
    el.title = chip.title
    // As large as three lines allow in the row: 13px type on 14px lines in
    // BBO's 46px rows, with a pixel of padding above and below.
    const h = rowHeight(row, cell)
    const lineH = Math.max(12, Math.floor((h - 4) / 3))
    Object.assign(el.style, {
      // Centred on the row, not the cell: BBO's cells are taller than the
      // rows that clip them (53.7px in a 46px row), so the cell's own middle
      // sits low.
      position: 'absolute',
      right: '3px',
      top: `${h / 2}px`,
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      fontSize: `${lineH - 1}px`,
      lineHeight: `${lineH}px`,
      padding: '1px 4px',
      borderRadius: '3px',
      background: 'rgba(255, 255, 255, 0.85)',
      whiteSpace: 'nowrap',
      pointerEvents: 'auto',
    })
    if (chip.clean) {
      el.textContent = 'clean'
      el.style.color = OPP_FG
      el.style.fontWeight = '600'
    } else {
      for (const { label, n, color } of chip.lines) {
        const line = doc.createElement('div')
        Object.assign(line.style, { display: 'flex', justifyContent: 'space-between', gap: '6px' })
        const name = doc.createElement('span')
        name.textContent = label
        const count = doc.createElement('span')
        count.textContent = String(n)
        Object.assign(count.style, { fontWeight: '700' })
        line.style.color = color
        line.append(name, count)
        el.appendChild(line)
      }
    }
    if (!cell.style.position) cell.style.position = 'relative'
    cell.appendChild(el)
  }
}

/** Totals for the event, in the board list's footer, left of BBO's own score
 *  totals. Sums only the boards analysed so far, and says how many that is:
 *  BBO loads a board when it is opened, so a past event fills in as you look. */
export function drawTotals(doc, list, entries, username, isVisible = defaultVisible) {
  const panel = [...doc.querySelectorAll('result-list')].find(isVisible)
  const existing = doc.querySelector(`.${TOTALS_CLASS}`)
  // The footer is the last row-shaped rectangle outside the board rows; the
  // header is the first. Its class ("mokmap") says nothing, so it isn't used.
  const rects = panel
    ? [...panel.querySelectorAll('celled-rectangle')].filter((r) => !r.closest('result-list-item'))
    : []
  const footer = rects.length >= 2 ? rects[rects.length - 1].querySelector('.rectangleClass') : null

  let checked = 0
  let any = false
  const sum = { me: 0, partner: 0, opps: 0, all: 0 }
  for (const board of list.boards) {
    const entry = entries.get(board.resultkey)
    if (!entry) continue
    checked++
    if (!entry.contract) continue
    sum.all += entry.trace.filter((t) => t.cost > 0).length
    const mySeat = board.mySeat ?? seatOf(board.players, username)
    const { counts } = summarizeTrace(entry.trace, {
      declarer: entry.declarer,
      mySeat,
      robotPartner: board.robotPartner ?? hasRobotPartner(board.players, mySeat),
    })
    if (!counts) continue
    any = true
    sum.me += counts.me.errors
    sum.partner += counts.partner.errors
    sum.opps += counts.opps.errors
  }
  if (!footer || checked === 0) {
    existing?.remove()
    return
  }
  const parts = any
    ? [
        { label: 'me', n: sum.me, color: ERROR_FG },
        { label: 'pd', n: sum.partner, color: PD_FG },
        { label: 'opp', n: sum.opps, color: OPP_FG },
      ]
    : [{ label: 'DD', n: sum.all, color: ERROR_FG }]
  // Match BBO's own totals beside it.
  const cells = footer.querySelectorAll('.cellClass')
  const fontSize = cells[cells.length - 1]?.style.fontSize || '22px'
  const key = `${checked} ${fontSize} ` + parts.map((p) => `${p.label}${p.n}`).join(' ')
  if (existing?.dataset.bcDdTotals === key && existing.parentElement === footer) return
  existing?.remove()

  const el = doc.createElement('div')
  el.className = TOTALS_CLASS
  el.dataset.bcDdTotals = key
  el.title =
    `Double-dummy errors on the ${checked} of ${list.boards.length} boards analysed so far. ` +
    'A board is analysed when it is opened.'
  Object.assign(el.style, {
    // Over BBO's four hidden cells (Board, Result, We, They: 70% of the row).
    position: 'absolute',
    left: '0',
    top: '0',
    bottom: '0',
    width: '70%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '0.6em',
    paddingRight: '0.5em',
    boxSizing: 'border-box',
    fontSize,
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
  })
  const label = doc.createElement('span')
  // No board count: the tags above show which boards are in it. The tooltip
  // still says.
  label.textContent = 'DD errors'
  label.style.color = MUTED_FG
  el.appendChild(label)
  for (const { label: name, n, color } of parts) {
    const part = doc.createElement('span')
    const count = doc.createElement('b')
    count.textContent = String(n)
    part.append(`${name} `, count)
    // Here a zero is news worth showing — a clean event for you — so it stays,
    // muted, where a board row would leave it out.
    part.style.color = n > 0 ? color : MUTED_FG
    el.appendChild(part)
  }
  if (!footer.style.position) footer.style.position = 'relative'
  footer.appendChild(el)
}

/** A button under BBO's deal menu, styled to sit beside it. `row` stacks
 *  them: 0 directly under the menu, 1 under that. `onClick` null removes it. */
function syncMenuButton(doc, viewer, { id, row, label, title, onClick }) {
  const existing = doc.getElementById(id)
  const menu = viewer?.querySelector('.moreClass')
  if (!menu || !onClick) {
    existing?.remove()
    return null
  }
  if (existing && existing.parentElement === menu.parentElement) {
    existing.onclick = (e) => {
      e.stopPropagation()
      onClick()
    }
    return existing
  }
  existing?.remove()
  const top = Number.parseFloat(menu.style.top) || 0
  const height = Number.parseFloat(menu.style.height) || 40
  const btn = doc.createElement('button')
  btn.id = id
  btn.type = 'button'
  btn.textContent = label
  btn.title = title
  Object.assign(btn.style, {
    position: 'absolute',
    left: menu.style.left,
    top: `${top + height + 6 + row * 30}px`,
    width: menu.style.width,
    height: '26px',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: '#1a73e8',
    color: '#fff',
    font: '600 13px sans-serif',
    cursor: 'pointer',
    zIndex: menu.style.zIndex || '300',
  })
  btn.onclick = (e) => {
    e.stopPropagation()
    onClick()
  }
  menu.parentElement.appendChild(btn)
  return btn
}

/** "DD Details": the board in Bridge Classroom's detailed double-dummy view. */
export function syncPopout(doc, viewer, onClick) {
  return syncMenuButton(doc, viewer, {
    id: POPOUT_ID,
    row: 0,
    label: 'DD Details',
    title: "Open this board's double-dummy details in Bridge Classroom",
    onClick,
  })
}

/** "Restart": back to the start of the play, so error cards already played
 *  are in the hands again to click. Shown only once play has moved on, in DD
 *  Details' place. */
export function syncRestart(doc, viewer, onClick) {
  return syncMenuButton(doc, viewer, {
    id: RESTART_ID,
    row: 0,
    label: '⟲ Restart',
    title: 'Back to the start of the play',
    onClick,
  })
}

// ── Controller ───────────────────────────────────────────────────────────────

export function startDdOverlay({
  doc = document,
  win = window,
  sendMessage,
  onError = () => {},
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  const state = {
    list: null,
    lists: new Map(), // every board list seen this visit, by tkey
    boards: new Map(), // resultkey → { tkey, number, mySeat, robotPartner }
    events: null, // BBO's list of recent events
    tallies: new Map(), // tkey → the event's tally
    run: null, // DD-all in progress: { stop, text, tkey }
    username: null,
    current: null, // the board BBO loaded last: { hk, lin, deal }
    hands: new Map(), // every board seen this visit, by resultkey
    entries: new Map(), // resultkey → background's analysis
    // My Table, the event being played: the boards opened so far, by number,
    // and which event they belong to ("52031~1").
    live: new Map(),
    liveEvent: null,
  }

  // BBO fetches a board once per visit and keeps it: going back to a board it
  // has shown before loads nothing, so "the last board loaded" is not always the
  // board on screen. The one on screen is whichever known deal its panels match,
  // the last loaded tried first.
  function onScreen() {
    const tried = state.current
      ? [state.current, ...state.hands.values()]
      : [...state.hands.values()]
    for (const hand of tried) {
      const matched = matchPanels(doc, hand.deal)
      if (matched) return { hand, matched }
    }
    return null
  }

  let queued = false
  function schedule() {
    if (queued) return
    queued = true
    win.requestAnimationFrame(() => {
      queued = false
      render()
    })
  }

  // Shown or hidden from BBO's deal menu (src/ui/ddMenu.js). Hidden, nothing is
  // drawn and nothing is solved; boards BBO loads are still noted, which costs
  // nothing and makes showing again immediate.
  let enabled = true
  function setEnabled(on) {
    if (enabled === !!on) return
    enabled = !!on
    if (enabled)
      catchUp().catch((err) => console.warn('[bc] double-dummy overlay:', err?.message ?? err))
    schedule()
  }

  function render() {
    if (!enabled) {
      clearAll(doc)
      return
    }
    const shownEvent = eventOnScreen()
    const loaded = shownEvent ? (state.lists.get(shownEvent.tkey) ?? state.list) : state.list
    const live = state.live.size ? { tkey: null, boards: [...state.live.values()] } : null
    const list = listOnScreen(doc, loaded)
      ? loaded
      : listOnScreen(doc, live, defaultVisible, { partial: true })
        ? live
        : null
    if (list) {
      drawIndex(doc, list, state.entries, state.username)
      drawTotals(doc, list, state.entries, state.username)
    } else {
      for (const el of doc.querySelectorAll(`.${CHIP_CLASS}, .${TOTALS_CLASS}`)) el.remove()
    }
    drawHistory(shownEvent)
    const shown = onScreen()
    if (!shown) {
      clearDeal(doc)
      syncPopout(doc, null)
      syncRestart(doc, null)
      return
    }
    const { hand: cur, matched } = shown
    const entry = state.entries.get(cur.hk)
    const summary = entry?.contract
      ? summarizeTrace(entry.trace, {
          declarer: entry.declarer,
          mySeat: seatOf(cur.players, state.username),
          trump: trumpOf(entry.contract),
          robotPartner: hasRobotPartner(cur.players, seatOf(cur.players, state.username)),
        })
      : null
    drawDeal(
      matched.hands,
      summary,
      doc,
      entry?.contract ? alternativesShown(cur, entry, matched.viewer) : null
    )
    drawTable(matched.viewer, summary)
    // One place under BBO's menu: DD Details at the start of the play, Restart
    // once it has moved on. A second button below would cover the par box
    // another extension draws there (seen 8 Nov 2026).
    const restart =
      summary && cardsPlayed(matched.viewer) > 0 ? () => jumpTo(matched.viewer, 0) : null
    syncPopout(doc, restart ? null : matched.viewer, () => popOut(cur.lin))
    syncRestart(doc, matched.viewer, restart)
  }

  // A click on an error card steps BBO's viewer to that card's trick. BBO
  // itself does nothing on a card click (checked), so nothing is overridden.
  // What an error should have been: once its trick is on the table, the
  // alternatives at that card, solved on demand and kept for the visit.
  const nodes = new Map() // resultkey → Map(play index → dd_play_node answer)
  function alternativesShown(hand, entry, viewer) {
    if (jumping) return null
    const played = cardsPlayed(viewer)
    if (played === 0 || played % 4 !== 0) return null
    const showing = played / 4
    let mine = nodes.get(hand.hk)
    if (!mine) nodes.set(hand.hk, (mine = new Map()))
    for (const t of entry.trace) {
      if (Math.floor(t.index / 4) + 1 !== showing || !(t.cost > 0) || mine.has(t.index)) continue
      mine.set(t.index, 'pending')
      sendMessage({ type: 'dd-node', lin: hand.lin, node: t.index })
        .then((res) => {
          mine.set(t.index, res?.type === 'dd-node' ? res.node : null)
          schedule()
        })
        .catch(() => mine.set(t.index, null))
    }
    return alternativesForTrick(entry.trace, showing, mine)
  }

  // Stepping BBO's viewer: an error card's click goes to its trick; Restart
  // goes back to the start. BBO does nothing itself on a card click (checked),
  // so nothing is overridden.
  let jumping = false
  const fast = (on) => win.postMessage({ source: `${TAG}:fast`, on }, win.location.origin)
  function jumpTo(viewer, trick) {
    const buttons = trickButtons(doc, defaultVisible, viewer)
    if (!buttons || jumping) return
    jumping = true
    // BBO animates each trick for about two seconds. The page hook cuts its
    // animation delays for the length of the jump, and only that long.
    fast(true)
    stepToTrick({
      ...buttons,
      cards: () => cardsInHands(viewer),
      sleep: (ms) => new Promise((r) => win.setTimeout(r, ms)),
      trick,
    })
      .catch((err) => console.warn('[bc] could not step to the trick:', err?.message ?? err))
      .finally(() => {
        fast(false)
        jumping = false
        schedule()
      })
  }

  doc.addEventListener(
    'click',
    (e) => {
      if (!enabled) return
      const card = e.target?.closest?.('[data-bc-dd]')
      if (!card || !card.closest('hand-diagram-panel')) return
      const trick = Number.parseInt(card.dataset.bcDd, 10)
      const viewer = card.closest('deal-viewer')
      if (!Number.isInteger(trick) || !viewer) return
      e.stopPropagation()
      jumpTo(viewer, trick)
    },
    true
  )

  async function popOut(lin) {
    const url = `https://www.bridgebase.com/tools/handviewer.html?lin=${encodeURIComponent(lin)}`
    const res = await sendMessage({ type: 'extract-session', url })
    if (res?.type === 'extraction-error') onError(res.error?.message ?? 'extraction failed')
  }

  // ── The list of events ─────────────────────────────────────────────────────

  // Which event the panel is showing, by its title. BBO may not ask for a board
  // list again on a second visit, so "the last list loaded" is not always this one.
  function eventOnScreen() {
    if (!state.events) return null
    const panel = [...doc.querySelectorAll('result-list')].find(defaultVisible)
    if (!panel) return null
    const bar = [...doc.querySelectorAll('title-bar')].find(defaultVisible)
    const title = bar?.textContent.replace(/\s+/g, ' ').trim()
    return state.events.find((e) => e.title?.replace(/\s+/g, ' ').trim() === title) ?? null
  }

  function drawHistory(shownEvent) {
    if (!state.events) return
    drawTallies(doc, state.events, state.tallies)
    syncHeader(doc, {
      text: state.run ? `${state.run.text} ✕` : 'DD ▾',
      title: state.run
        ? 'Stop the analysis'
        : 'Double-dummy errors: you-partner-opponents. * means some boards are still to do.',
      onClick: state.run ? () => (state.run.stop = true) : showMenu,
    })
    const mine = state.run?.tkey === shownEvent?.tkey
    syncEventButton(doc, {
      text: state.run && mine ? `${state.run.text} ✕` : 'DD all',
      title: state.run && mine ? 'Stop the analysis' : "Analyse all of this event's boards",
      onClick:
        !shownEvent ||
        (state.run && !mine) ||
        (!state.run && isComplete(state.tallies.get(shownEvent.tkey), shownEvent))
          ? null
          : state.run
            ? () => (state.run.stop = true)
            : () => runEvents([shownEvent]),
    })
  }

  function showMenu(anchor) {
    if (doc.getElementById(MENU_ID)) return closeMenu(doc)
    const items = menuRanges().map(({ label, since }) => {
      const events = eventsToRun(state.events, state.tallies, since)
      const inRange = state.events.some((e) => since === null || (e.started ?? 0) >= since)
      return { label, count: events.length, inRange, onPick: () => runEvents(events) }
    })
    openMenu(doc, anchor, items)
    // Closes on the next click anywhere else.
    win.setTimeout(() => {
      doc.addEventListener('click', () => closeMenu(doc), { once: true })
    }, 0)
  }

  async function runEvents(events) {
    if (state.run || !events.length) return
    state.run = {
      stop: false,
      text: '…',
      tkey: events.length === 1 ? events[0].tkey : null,
    }
    schedule()
    const run = state.run
    try {
      const result = await analyzeEvents({
        events,
        tallies: state.tallies,
        fetchList: async (event) => parseMhList(await fetchEventList(fetchImpl, event)),
        fetchHand: async (hk) => parseMhHand(await fetchBoard(fetchImpl, hk)),
        noteList: (event, list) => noteList(list, event.username),
        solve: (hand) => solveBoard(hand),
        sleep: (ms) => new Promise((r) => win.setTimeout(r, ms)),
        shouldStop: () => run.stop || !enabled,
        onProgress: ({ eventIndex, eventCount, done, total }) => {
          run.text =
            eventCount > 1 ? `${eventIndex + 1}/${eventCount}` : total ? `${done}/${total}` : '…'
          schedule()
        },
      })
      if (result.failed) {
        onError(
          `${result.failed} could not be analysed (${result.error}). Run it again to pick up the rest.`
        )
      }
    } catch (err) {
      onError(err?.message ?? String(err))
    } finally {
      state.run = null
      schedule()
    }
  }

  async function refreshTallies(tkeys) {
    const res = await sendMessage({ type: 'dd-tallies', tkeys })
    for (const [k, v] of Object.entries(res?.tallies ?? {})) state.tallies.set(k, v)
    schedule()
  }

  // ── Boards ─────────────────────────────────────────────────────────────────

  // A board list has been seen, from BBO or from DD-all: remember whose seat is
  // whose (nothing stored names a player, so this is worked out fresh), and collect
  // what the cache already knows. Resolves to the event's tally.
  async function noteList(list, username) {
    if (!list.tkey) return null
    state.lists.set(list.tkey, list)
    for (const b of list.boards) {
      const mySeat = seatOf(b.players, username)
      state.boards.set(b.resultkey, {
        tkey: list.tkey,
        number: b.number,
        mySeat,
        robotPartner: hasRobotPartner(b.players, mySeat),
      })
    }
    const res = await sendMessage({
      type: 'dd-event',
      tkey: list.tkey,
      boards: list.boards.map((b) => ({
        resultkey: b.resultkey,
        ...state.boards.get(b.resultkey),
      })),
    })
    for (const [k, v] of Object.entries(res?.entries ?? {})) state.entries.set(k, v)
    if (res?.tally) state.tallies.set(list.tkey, res.tally)
    schedule()
    return res?.tally ?? null
  }

  async function solveBoard(hand) {
    const place = state.boards.get(hand.hk) ?? null
    const res = await sendMessage({ type: 'dd-trace', resultkey: hand.hk, lin: hand.lin, place })
    if (res?.type !== 'dd-trace') throw new Error(res?.error ?? 'no analysis')
    state.entries.set(hand.hk, res.entry)
    if (place) await refreshTallies([place.tkey])
    schedule()
  }

  async function solve(hand) {
    if (state.entries.has(hand.hk)) return
    await solveBoard(hand)
  }

  // Shown again after being hidden: pick up whatever BBO loaded meanwhile.
  async function catchUp() {
    if (state.events) await refreshTallies(state.events.map((e) => e.tkey))
    if (state.list) await noteList(state.list, state.username)
    for (const hand of state.hands.values()) await solve(hand)
  }

  async function handle(msg) {
    if (msg.kind === 'live-user') {
      // Who is signed in, from BBO's login message: the seat to count as "me" on
      // My Table, where no History request names the player.
      state.liveUser = typeof msg.body === 'string' && msg.body ? msg.body : null
      state.username ??= state.liveUser
      return
    }
    if (msg.kind === 'live-hand') {
      const { hk, lin, number } = parseBoardDetails(msg.body)
      const players = parseLinPlayers(lin)
      state.current = { hk, lin, deal: parseLin(lin).deal, players }
      state.hands.set(hk, state.current)
      // My Table's own boards only, not another table's that the player looked
      // at: those share the board number.
      const me = state.liveUser ?? state.username
      if (!me || seatOf(players, me)) {
        const event = hk.split('~').slice(2, 4).join('~')
        if (event !== state.liveEvent) {
          state.live.clear()
          state.liveEvent = event
        }
        const board = { number, resultkey: hk, result: resultOfLin(lin), players }
        state.live.set(number, board)
        // Kept, without names, so a reload does not lose My Table's tags.
        sendMessage({
          type: 'dd-live-note',
          event,
          board: {
            number,
            resultkey: hk,
            result: board.result,
            mySeat: seatOf(players, me),
            robotPartner: hasRobotPartner(players, seatOf(players, me)),
          },
        }).catch(() => {})
      }
      schedule()
      if (enabled) await solve(state.current)
      return
    }
    if (msg.kind === 'ard') {
      // A daylong's My Table: every board of the event so far, in one answer.
      // Everyone else at the table is a robot, so every board is the user's own.
      const { tid, boards } = parseArdDeals(msg.body)
      if (tid !== state.liveEvent) {
        state.live.clear()
        state.liveEvent = tid
      }
      for (const b of boards) {
        const hand = { hk: b.hk, lin: b.lin, deal: parseLin(b.lin).deal, players: b.players }
        state.hands.set(b.hk, hand)
        state.live.set(b.number, {
          number: b.number,
          resultkey: b.hk,
          result: b.result,
          players: b.players,
        })
      }
      schedule()
      if (enabled) for (const b of boards) await solve(state.hands.get(b.hk))
      return
    }
    if (msg.kind === 'events') {
      state.events = parseTfind(msg.body)
      if (enabled) await refreshTallies(state.events.map((e) => e.tkey))
      schedule()
    } else if (msg.kind === 'list') {
      const list = parseMhList(msg.body)
      state.list = list
      state.username = new URLSearchParams(msg.requestBody ?? '').get('username') || list.username
      state.lists.set(list.tkey, list)
      if (enabled) await noteList(list, state.username)
    } else if (msg.kind === 'hand') {
      const { hk, lin } = parseMhHand(msg.body)
      state.current = { hk, lin, deal: parseLin(lin).deal, players: parseLinPlayers(lin) }
      state.hands.set(hk, state.current)
      schedule()
      if (enabled) await solve(state.current)
    }
  }

  win.addEventListener('message', (e) => {
    if (e.source !== win || e.data?.source !== TAG) return
    handle(e.data).catch((err) => console.warn('[bc] double-dummy overlay:', err?.message ?? err))
  })
  // In case BBO loaded something before this script started.
  win.postMessage({ source: `${TAG}:replay` }, win.location.origin)

  // After a reload, My Table's boards seen before it: the game connection sends a
  // board only when it is opened, so without this their tags would wait for a
  // click each. Shown only where the results on screen agree (listOnScreen).
  sendMessage({ type: 'dd-live-table' })
    .then((res) => {
      const table = res?.table
      if (!table || state.live.size) return
      state.liveEvent = table.event
      for (const b of table.boards) state.live.set(b.number, { ...b, players: null })
      for (const [k, v] of Object.entries(table.entries ?? {})) state.entries.set(k, v)
      schedule()
    })
    .catch(() => {})

  return { render: schedule, setEnabled, state }
}
