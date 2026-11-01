// Per-card double-dummy drawn into the BBO v3 History panel.
//
//   • the open board: each played card gets the number of the trick it went to,
//     and a card that cost its side a trick is marked in red
//   • the board list: a small chip per board counting double-dummy errors by
//     you, your partner and the opponents
//   • a button under BBO's own deal menu that sends the board to Bridge
//     Classroom
//
// Nothing here fetches from BBO. The page hook (public/bbo-page-hook.js) passes
// on copies of what BBO's History panel itself loads — mh_list.php when an
// event opens, mh_hand.php for each board shown — and the background solves
// each board once, in WASM, caching the result for a fortnight. Going back to
// an event later redraws from the cache.
//
// BBO's markup is a production Angular build: custom elements, inline absolute
// positioning, no stable ids. Everything below is located by element name and
// checked before use, and a board is drawn only when the panels on screen
// demonstrably hold the deal we analysed. A mismatch draws nothing rather than
// something wrong.

import { parseMhList, parseMhHand } from '../adapters/bbo/parsers/mhXml.js'
import { parseLin } from '../adapters/bbo/parsers/lin.js'
import { summarizeTrace, seatOf, solverCard, trumpOf } from '../lib/ddPlay.js'

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

const defaultVisible = (el) => !!el && el.getClientRects().length > 0

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
    const suit = SUIT_BY_SYMBOL[sym.textContent.trim()]
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

/** The four visible hands, each tied to its seat in `deal` (parseLin's deal).
 *  Returns [{ seat, cards }] or null unless every visible card sits in the hand
 *  the LIN gives it — the check that we are drawing on the board we solved. */
export function matchPanels(doc, deal, isVisible = defaultVisible) {
  const seatOfCard = {}
  for (const seat of ['N', 'E', 'S', 'W']) {
    for (const suit of ['S', 'H', 'D', 'C']) {
      for (const r of deal[seat][suit]) seatOfCard[solverCard(suit + r)] = seat
    }
  }
  const viewer = [...doc.querySelectorAll('deal-viewer')].find(isVisible)
  if (!viewer) return null
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
  return out.length ? { viewer, hands: out } : null
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
    const text = card.textContent.replace(/[\s+−-]\d*$/u, '').replace(/\s+/g, '')
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

/** BBO's own Previous trick / Next trick buttons, or null. */
export function trickButtons(doc, isVisible = defaultVisible) {
  const find = (label) =>
    [...doc.querySelectorAll('button')].find(
      (b) => isVisible(b) && b.textContent.trim() === label
    ) ?? null
  const prev = find('Previous trick')
  const next = find('Next trick')
  return prev && next ? { prev, next } : null
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
      const mySeat = seatOf(entry.players, username)
      const { counts } = summarizeTrace(entry.trace, { declarer: entry.declarer, mySeat })
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
    const { counts } = summarizeTrace(entry.trace, {
      declarer: entry.declarer,
      mySeat: seatOf(entry.players, username),
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

/** "Classroom": send this board to Bridge Classroom. */
export function syncPopout(doc, viewer, onClick) {
  return syncMenuButton(doc, viewer, {
    id: POPOUT_ID,
    row: 0,
    label: 'Classroom',
    title: 'Open this board in Bridge Classroom',
    onClick,
  })
}

/** "Restart": back to the start of the play, so error cards already played
 *  are in the hands again to click. Shown only once play has moved on. */
export function syncRestart(doc, viewer, onClick) {
  return syncMenuButton(doc, viewer, {
    id: RESTART_ID,
    row: 1,
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
  onNotice = onError,
}) {
  const state = {
    list: null,
    username: null,
    current: null, // the board BBO loaded last: { hk, lin, deal }
    hands: new Map(), // every board seen this visit, by resultkey
    entries: new Map(), // resultkey → background's analysis
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

  function render() {
    if (state.list) {
      drawIndex(doc, state.list, state.entries, state.username)
      drawTotals(doc, state.list, state.entries, state.username)
    }
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
          mySeat: seatOf(entry.players, state.username),
          trump: trumpOf(entry.contract),
        })
      : null
    drawDeal(
      matched.hands,
      summary,
      doc,
      entry?.contract ? alternativesShown(cur, entry, matched.viewer) : null
    )
    drawTable(matched.viewer, summary)
    syncPopout(doc, matched.viewer, () => popOut(cur.lin))
    syncRestart(
      doc,
      matched.viewer,
      summary && cardsPlayed(matched.viewer) > 0 ? () => jumpTo(matched.viewer, 0) : null
    )
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
  let tipShown = false
  function jumpTo(viewer, trick) {
    const buttons = trickButtons(doc)
    if (!buttons || jumping) return
    if (trick > cardsPlayed(viewer) / 4 && animationOn() && !tipShown) {
      tipShown = true
      onNotice(
        'BBO animates each trick, so this takes a moment. Turning off Animation in ' +
          'Account ▸ Settings makes it instant.'
      )
    }
    jumping = true
    stepToTrick({
      ...buttons,
      cards: () => cardsInHands(viewer),
      sleep: (ms) => new Promise((r) => win.setTimeout(r, ms)),
      trick,
    })
      .catch((err) => console.warn('[bc] could not step to the trick:', err?.message ?? err))
      .finally(() => {
        jumping = false
        schedule()
      })
  }

  // BBO keeps its Animation setting in its own localStorage, per user ("n" when
  // off), and reads it only when the client starts — so it can be read here but
  // not usefully changed. Unset means BBO's default, which is on.
  function animationOn() {
    if (!state.username) return true
    try {
      return win.localStorage.getItem(`${state.username}_general_animate`) !== 'n'
    } catch {
      return true
    }
  }

  doc.addEventListener(
    'click',
    (e) => {
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

  async function handle(msg) {
    if (msg.kind === 'list') {
      const list = parseMhList(msg.body)
      state.list = list
      state.username = new URLSearchParams(msg.requestBody ?? '').get('username') || list.username
      const res = await sendMessage({
        type: 'dd-lookup',
        resultkeys: list.boards.map((b) => b.resultkey),
      })
      for (const [k, v] of Object.entries(res?.entries ?? {})) state.entries.set(k, v)
      schedule()
    } else if (msg.kind === 'hand') {
      const { hk, lin } = parseMhHand(msg.body)
      state.current = { hk, lin, deal: parseLin(lin).deal }
      state.hands.set(hk, state.current)
      schedule()
      if (state.entries.has(hk)) return
      const res = await sendMessage({ type: 'dd-trace', resultkey: hk, lin })
      if (res?.type !== 'dd-trace') throw new Error(res?.error ?? 'no analysis')
      state.entries.set(hk, res.entry)
      schedule()
    }
  }

  win.addEventListener('message', (e) => {
    if (e.source !== win || e.data?.source !== TAG) return
    handle(e.data).catch((err) => console.warn('[bc] double-dummy overlay:', err?.message ?? err))
  })
  // In case BBO loaded something before this script started.
  win.postMessage({ source: `${TAG}:replay` }, win.location.origin)

  return { render: schedule, state }
}
