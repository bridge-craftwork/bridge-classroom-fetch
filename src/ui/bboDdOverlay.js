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
export const POPOUT_ID = 'bridge-classroom-dd-popout'

const SUIT_BY_SYMBOL = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }
const ERROR_BG = 'rgba(220, 0, 0, 0.22)'
const ERROR_FG = 'rgb(200, 0, 0)'
const TRICK_FG = 'rgb(110, 110, 110)'

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
      const info = summary?.cards[code]
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
        fontWeight: info.cost > 0 ? '700' : '400',
        color: info.cost > 0 ? ERROR_FG : TRICK_FG,
      })
      el.appendChild(badge)
      if (info.cost > 0) el.style.backgroundColor = ERROR_BG
      el.title =
        info.cost > 0
          ? `Trick ${info.trick}: double-dummy error, cost ${info.cost} trick${info.cost === 1 ? '' : 's'}`
          : `Trick ${info.trick}`
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

/** The chip's text and tooltip for one board, or null when there is nothing
 *  to say (no errors, or not analysed yet). */
export function chipFor(counts, totalErrors) {
  if (!counts) {
    return totalErrors > 0
      ? {
          text: `DD ${totalErrors}`,
          title: `${totalErrors} double-dummy error${totalErrors === 1 ? '' : 's'}`,
        }
      : null
  }
  const { me, partner, opps } = counts
  if (me.errors + partner.errors + opps.errors === 0) return null
  const part = (label, c) => `${label} ${c.errors}`
  const long = (label, c) =>
    `${label}: ${c.errors}${c.errors ? ` (${c.tricks} trick${c.tricks === 1 ? '' : 's'})` : ''}`
  return {
    text: [part('me', me), part('pd', partner), part('opp', opps)].join(' · '),
    title: `Double-dummy errors — ${long('you', me)}, ${long('partner', partner)}, ${long('opponents', opps)}`,
  }
}

/** One chip per analysed board in the visible board list. */
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
    if (existing?.textContent === chip.text) continue
    existing?.remove()
    const el = doc.createElement('span')
    el.className = CHIP_CLASS
    el.textContent = chip.text
    el.title = chip.title
    Object.assign(el.style, {
      // Top, not bottom: BBO's cells are taller than the rows that clip them
      // (53.7px in a 46px row), so the bottom edge is out of sight.
      position: 'absolute',
      right: '3px',
      top: '2px',
      fontSize: '11px',
      lineHeight: '13px',
      padding: '0 3px',
      borderRadius: '3px',
      background: 'rgba(255, 255, 255, 0.85)',
      color: ERROR_FG,
      pointerEvents: 'auto',
      whiteSpace: 'nowrap',
    })
    if (!cell.style.position) cell.style.position = 'relative'
    cell.appendChild(el)
  }
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
    if (state.list) drawIndex(doc, state.list, state.entries, state.username)
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
