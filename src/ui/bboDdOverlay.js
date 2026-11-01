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
import { summarizeTrace, seatOf, solverCard } from '../lib/ddPlay.js'

const TAG = 'bridge-classroom-bbo'
const BADGE_CLASS = 'bc-dd-trick'
const CHIP_CLASS = 'bc-dd-chip'
const TOTALS_CLASS = 'bc-dd-totals'
export const POPOUT_ID = 'bridge-classroom-dd-popout'

const SUIT_BY_SYMBOL = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }
const ERROR_BG = 'rgba(220, 0, 0, 0.22)'
const ERROR_FG = 'rgb(200, 0, 0)'
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
export function drawDeal(hands, summary, doc) {
  for (const { cards } of hands) {
    for (const { el, code } of cards) {
      // Errors only. Every card's trick is known, but numbering all 52 makes a
      // diagram nobody can read at a glance; the errors are what to look at.
      const played = summary?.cards[code]
      const info = played?.cost > 0 ? played : null
      const want = info ? `${info.trick}:${info.cost}` : ''
      if ((el.dataset.bcDd ?? '') === want) continue
      el.querySelector(`.${BADGE_CLASS}`)?.remove()
      el.style.backgroundColor = el.dataset.bcDdBg ?? el.style.backgroundColor
      delete el.dataset.bcDd
      if (!info) continue
      el.dataset.bcDdBg ??= el.style.backgroundColor
      el.dataset.bcDd = want
      const badge = doc.createElement('span')
      badge.className = BADGE_CLASS
      badge.textContent = String(info.trick)
      Object.assign(badge.style, {
        fontSize: '0.55em',
        verticalAlign: 'sub',
        marginLeft: '1px',
        fontWeight: '700',
        color: ERROR_FG,
      })
      el.appendChild(badge)
      el.style.backgroundColor = ERROR_BG
      el.title = `Trick ${info.trick}: double-dummy error, cost ${info.cost} trick${info.cost === 1 ? '' : 's'}`
    }
  }
}

/** Remove every mark we made in the deal viewer. */
export function clearDeal(doc) {
  for (const el of doc.querySelectorAll('[data-bc-dd]')) {
    el.querySelector(`.${BADGE_CLASS}`)?.remove()
    if (el.dataset.bcDdBg !== undefined) el.style.backgroundColor = el.dataset.bcDdBg
    delete el.dataset.bcDd
    delete el.dataset.bcDdBg
    el.removeAttribute('title')
  }
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

/** A button under BBO's deal menu, styled to sit beside it. */
export function syncPopout(doc, viewer, onClick) {
  const existing = doc.getElementById(POPOUT_ID)
  const menu = viewer?.querySelector('.moreClass')
  if (!menu) {
    existing?.remove()
    return null
  }
  if (existing && existing.parentElement === menu.parentElement) return existing
  existing?.remove()
  const top = Number.parseFloat(menu.style.top) || 0
  const height = Number.parseFloat(menu.style.height) || 40
  const btn = doc.createElement('button')
  btn.id = POPOUT_ID
  btn.type = 'button'
  btn.textContent = 'Classroom'
  btn.title = 'Open this board in Bridge Classroom'
  Object.assign(btn.style, {
    position: 'absolute',
    left: menu.style.left,
    top: `${top + height + 6}px`,
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
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  menu.parentElement.appendChild(btn)
  return btn
}

// ── Controller ───────────────────────────────────────────────────────────────

export function startDdOverlay({ doc = document, win = window, sendMessage, onError = () => {} }) {
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
      return
    }
    const { hand: cur, matched } = shown
    const entry = state.entries.get(cur.hk)
    const summary = entry?.contract
      ? summarizeTrace(entry.trace, {
          declarer: entry.declarer,
          mySeat: seatOf(entry.players, state.username),
        })
      : null
    drawDeal(matched.hands, summary, doc)
    syncPopout(doc, matched.viewer, () => popOut(cur.lin))
  }

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
