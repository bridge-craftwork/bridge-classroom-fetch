// The double-dummy table on BBO's deal viewer: Bridge Classroom's table
// (DoubleDummyTable.vue, compact form), drawn in the corner under West's hand.
//
// The played contract's cell is green, as in the classroom. Par cells are bold,
// where the classroom shows a bidding engine's contract instead; the contract
// itself is not bold here, so the two never read alike. Both: green and bold.
//
// BBO Helper draws its own table in the same corner (div.bhDoubleDummy, added to
// the felt and re-shown on every board and every server answer). While ours is
// drawn on a viewer, that viewer carries OWNS_CLASS and a stylesheet hides
// theirs: a rule wins whichever extension runs first and however late their
// answer arrives, and taking ours away brings theirs back. Their par box is left.
// While ours is on its way, theirs is hidden already: shown and then replaced,
// it reads as a table that changes its mind.
//
// The result at this table goes beside BBO's deal menu, above their par box:
// the corner has no room for it once all four rows show.

import { buildDdRows, collapseDdRows, cellTitle, DISPLAY_STRAINS } from '../lib/ddTable.js'

export const DD_TABLE_CLASS = 'bc-dd-table'
export const OWNS_CLASS = 'bc-dd-owns'
export const RESULT_ID = 'bridge-classroom-dd-result'
const STYLE_ID = 'bc-dd-table-style'

const HEAD_BG = '#f3f3f0'
const HEAD_FG = '#666'
const RULE = '#ddd'
const RED = '#d32f2f'
const BLACK = '#1a1a1a'
const CONTRACT_BG = '#d4edda'
const CONTRACT_FG = '#155724'
const GLYPH = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent =
    `.${OWNS_CLASS} .bhDoubleDummy { display: none !important; }\n` +
    // BBO's own rules leave table cells unstyled, but a page can change that.
    `.${DD_TABLE_CLASS} table { border-collapse: collapse; }\n` +
    `.${DD_TABLE_CLASS} th, .${DD_TABLE_CLASS} td { border: 0.5px solid ${RULE}; ` +
    `padding: 0.1em 0.15em; min-width: 1.2em; text-align: center; line-height: 1.15; }`
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

function buildTable(doc, rows, contract) {
  const table = doc.createElement('table')
  Object.assign(table.style, {
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
    background: '#fff',
    color: BLACK,
  })
  const head = table.createTHead().insertRow()
  const corner = doc.createElement('th')
  Object.assign(corner.style, { background: HEAD_BG })
  head.appendChild(corner)
  for (const strain of DISPLAY_STRAINS) {
    const th = doc.createElement('th')
    th.textContent = GLYPH[strain]
    Object.assign(th.style, {
      background: HEAD_BG,
      fontWeight: '600',
      color: strain === 'D' || strain === 'H' ? RED : strain === 'NT' ? HEAD_FG : BLACK,
    })
    head.appendChild(th)
  }
  const body = table.createTBody()
  for (const row of rows) {
    const tr = body.insertRow()
    const seat = doc.createElement('th')
    seat.textContent = row.seat
    Object.assign(seat.style, { background: HEAD_BG, fontWeight: '600', color: BLACK })
    tr.appendChild(seat)
    row.cells.forEach((cell, i) => {
      const td = tr.insertCell()
      td.textContent = String(cell.tricks)
      td.title = cellTitle(row.seat, i, cell, contract)
      td.style.fontWeight = cell.isPar ? '700' : '400'
      if (cell.isContract) Object.assign(td.style, { background: CONTRACT_BG, color: CONTRACT_FG })
      if (cell.isContract) td.dataset.bcDdContract = '1'
      if (cell.isPar) td.dataset.bcDdPar = '1'
    })
  }
  return table
}

// The hand panels that are showing. BBO hides them all for its pictures-of-cards
// layout, where there is no corner to use.
function panelsOf(viewer) {
  return [...viewer.querySelectorAll('.handDiagramPanelClass')].filter(
    (p) => p.style.display !== 'none'
  )
}

// Under the leftmost hand, centred in the space between it and the felt's
// bottom, as large as fits: BBO scales its type with the viewer's width.
function place(box, felt, panels) {
  const left = panels.reduce((a, b) => (b.offsetLeft < a.offsetLeft ? b : a))
  const below = left.offsetTop + left.offsetHeight
  const room = felt.offsetHeight - below
  for (let size = 22; size >= 9; size -= 1) {
    box.style.fontSize = `${size}px`
    if (box.offsetWidth <= 0.96 * left.offsetWidth && box.offsetHeight <= 0.96 * room) break
  }
  const x = left.offsetLeft + (left.offsetWidth - box.offsetWidth) / 2
  const y = below + (room - box.offsetHeight) / 2
  box.style.left = `${Math.round(Math.max(0, x))}px`
  box.style.top = `${Math.round(Math.max(below, y))}px`
}

/** Remove our table from every viewer but `keep`, and give BBO Helper's back. */
export function clearDdTables(doc, keep = null) {
  for (const box of doc.querySelectorAll(`.${DD_TABLE_CLASS}`)) {
    if (!keep || !keep.contains(box)) box.remove()
  }
  for (const viewer of doc.querySelectorAll(`.${OWNS_CLASS}`)) {
    if (viewer !== keep) viewer.classList.remove(OWNS_CLASS)
  }
}

/** Draw `table` ({ tricks, par }, from the background) on `viewer`, marking
 *  `contract` by `declarer`. Idempotent: called on every render, it rebuilds
 *  only when the table or the layout it was fitted to has changed. Returns
 *  whether a table is drawn. `pending`, with no table yet: one is on its way,
 *  so BBO Helper's is hidden already and the corner waits for ours. */
export function drawDdTable(
  doc,
  viewer,
  table,
  { contract = null, declarer = null, pending = false } = {}
) {
  const felt = viewer?.querySelector('.coverClass')
  const panels = viewer ? panelsOf(viewer) : []
  const rows = collapseDdRows(
    buildDdRows(table?.tricks, { contract, declarer, par: table?.par ?? null })
  )
  if (!felt || panels.length !== 4 || !rows) {
    clearDdTables(doc, null)
    if (felt && panels.length === 4 && pending) {
      ensureStyle(doc)
      viewer.classList.add(OWNS_CLASS)
    }
    return false
  }
  clearDdTables(doc, viewer)
  ensureStyle(doc)
  viewer.classList.add(OWNS_CLASS)

  let box = felt.querySelector(`.${DD_TABLE_CLASS}`)
  if (!box) {
    box = doc.createElement('div')
    box.className = DD_TABLE_CLASS
    Object.assign(box.style, {
      position: 'absolute',
      zIndex: '-1', // under a hand that grows into it, as BBO Helper's is
      border: '1px solid #808080',
      background: '#fff',
      lineHeight: '1.15',
      fontFamily: 'inherit',
    })
    felt.appendChild(box)
  }
  const content = JSON.stringify([rows, contract, declarer, table.parScore ?? null])
  if (box.dataset.bcDdContent !== content) {
    box.replaceChildren(buildTable(doc, rows, contract ?? ''))
    box.title = table.parScore ? `Par: ${table.par ?? 'pass'} (${table.parScore})` : ''
    box.dataset.bcDdContent = content
    delete box.dataset.bcDdLayout
  }
  // BBO positions everything with inline styles, so their text is the layout.
  const layout = [felt.style.cssText, ...panels.map((p) => p.style.cssText)].join('|')
  if (box.dataset.bcDdLayout !== layout) {
    place(box, felt, panels)
    box.dataset.bcDdLayout = layout
  }
  return true
}

const RESULT_RE = /^([1-7])(N|NT|[CDHS])([NESW])(x{0,2})(=|[+-]\d{1,2})$/i

/** History's result text ("4HE+1", "3NS=", "5HNx-2") → [{ text, color }] to
 *  draw, as BBO's list shows it but with the suit's glyph: 4♥E+1, 3NTS=. Null
 *  for anything else (passed out, not yet played). */
export function resultParts(result) {
  const m = RESULT_RE.exec(String(result ?? '').trim())
  if (!m) return null
  const strain = m[2].toUpperCase() === 'N' ? 'NT' : m[2].toUpperCase()
  return [
    { text: m[1], color: BLACK },
    { text: GLYPH[strain], color: strain === 'D' || strain === 'H' ? RED : BLACK },
    { text: m[3].toUpperCase() + m[4].toLowerCase() + m[5], color: BLACK },
  ]
}

/** The result at this table, in a box left of BBO's deal menu and level with
 *  it, styled as BBO Helper's par box below. `result` null removes it. */
export function syncResult(doc, viewer, result) {
  const parts = resultParts(result)
  const menu = viewer?.querySelector('.moreClass')
  let box = doc.getElementById(RESULT_ID)
  if (!parts || !menu) {
    box?.remove()
    return null
  }
  if (box && box.parentElement !== menu.parentElement) {
    box.remove()
    box = null
  }
  if (!box) {
    box = doc.createElement('div')
    box.id = RESULT_ID
    box.title = 'The result at this table'
    Object.assign(box.style, {
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      boxSizing: 'border-box',
      padding: '0 0.4em',
      border: '1px solid #808080',
      background: '#fff',
      fontWeight: '700',
      whiteSpace: 'nowrap',
      zIndex: menu.style.zIndex || '300',
    })
    menu.parentElement.appendChild(box)
  }
  const key = [result, menu.style.cssText].join('|')
  if (box.dataset.bcDdResult === key) return box
  box.replaceChildren(
    ...parts.map(({ text, color }) => {
      const span = doc.createElement('span')
      span.textContent = text
      span.style.color = color
      return span
    })
  )
  const left = Number.parseFloat(menu.style.left) || 0
  const top = Number.parseFloat(menu.style.top) || 0
  const height = Number.parseFloat(menu.style.height) || 40
  // North's hand ends somewhere left of the menu; stay clear of it. Read from
  // BBO's inline styles, the frame the menu's own position is in.
  const px = (el, k) => Number.parseFloat(el.style[k]) || 0
  const north = panelsOf(viewer).reduce((a, b) => (!a || px(b, 'top') < px(a, 'top') ? b : a), null)
  const room = north ? left - (px(north, 'left') + px(north, 'width')) - 12 : Infinity
  box.style.top = `${top}px`
  box.style.height = `${height}px`
  for (let size = Math.round(height * 0.55); size >= 10; size -= 1) {
    box.style.fontSize = `${size}px`
    if (box.offsetWidth <= room) break
  }
  box.style.left = `${Math.round(left - box.offsetWidth - 6)}px`
  box.dataset.bcDdResult = key
  return box
}
