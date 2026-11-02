// Bridge Craftwork DD on BBO's list of recent tournaments: each event's error
// tally in the last column, and the menu and button that fill them in.
//
// The last column is BBO's Prize. It is blank unless a prize was won, so it is
// relabelled while the extension is showing, and a row with a real prize keeps it.
// Hiding the extension puts the column back exactly as it was.
//
// Located by element name and shape, as the rest of the overlay is, and
// checked: a list that is not the shape expected is left alone.

const TALLY_CLASS = 'bc-dd-tally'
const HEADER_CLASS = 'bc-dd-history-header'
export const MENU_ID = 'bridge-craftwork-dd-menu'
export const EVENT_BUTTON_ID = 'bridge-craftwork-dd-all'
const COLUMNS = 6

const ME_FG = 'rgb(200, 0, 0)'
const PD_FG = 'rgb(205, 100, 0)'
const OPP_FG = 'rgb(0, 130, 40)'
const MUTED_FG = 'rgb(110, 110, 110)'

const shown = (el) => !!el && el.getClientRects().length > 0

/** { me, partner, opps, counted, total, partial }, or null when there is nothing
 *  to say: never opened, or opened with no board yet analysed. */
export function tallySummary(tally) {
  if (!tally || tally.total === null) return null
  const boards = Object.values(tally.b)
  if (tally.total > 0 && boards.length === 0) return null
  const sum = (i) => boards.reduce((n, b) => n + b[i], 0)
  return {
    me: sum(0),
    partner: sum(1),
    opps: sum(2),
    counted: boards.length,
    total: tally.total,
    partial: boards.length < tally.total,
  }
}

function visibleList(doc, isVisible) {
  return [...doc.querySelectorAll('historic-tournament-list')].find(isVisible) ?? null
}

function titleFor(summary) {
  if (summary.total === 0) return "BBO's History has no boards for this event"
  const base =
    `Double-dummy errors: you ${summary.me}, partner ${summary.partner}, ` +
    `opponents ${summary.opps}. ${summary.counted} of ${summary.total} boards analysed.`
  return summary.partial ? `${base} The * means the rest are still to do.` : base
}

function tallyKey(summary) {
  return summary.total === 0
    ? 'none'
    : `${summary.me}-${summary.partner}-${summary.opps}${summary.partial ? '*' : ''}`
}

function fillTally(doc, el, summary) {
  el.replaceChildren()
  if (summary.total === 0) {
    el.textContent = '–'
    el.style.color = MUTED_FG
    return
  }
  const part = (text, color) => {
    const span = doc.createElement('span')
    span.textContent = text
    span.style.color = color
    el.appendChild(span)
  }
  part(String(summary.me), ME_FG)
  part('-', MUTED_FG)
  part(String(summary.partner), PD_FG)
  part('-', MUTED_FG)
  part(String(summary.opps), OPP_FG)
  if (summary.partial) part('*', MUTED_FG)
}

/** Each event's tally in the last column of its row. A number in the first column
 *  that two events share ties the row to neither, so it gets nothing. */
export function drawTallies(doc, events, tallies, isVisible = shown) {
  const list = visibleList(doc, isVisible)
  if (!list) return
  const counts = new Map()
  for (const e of events) counts.set(e.number, (counts.get(e.number) ?? 0) + 1)
  const byNumber = new Map(events.filter((e) => counts.get(e.number) === 1).map((e) => [e.number, e]))

  for (const row of list.querySelectorAll('historic-tournament-list-item')) {
    const cells = row.querySelectorAll('celled-rectangle .cellClass')
    if (cells.length !== COLUMNS) continue
    const event = byNumber.get(cells[0].textContent.trim())
    const last = cells[COLUMNS - 1]
    const inner = last.querySelector('.innerClass')
    const existing = last.querySelector(`.${TALLY_CLASS}`)
    const summary = event ? tallySummary(tallies.get(event.tkey)) : null
    if (!inner || !summary) {
      existing?.remove()
      continue
    }
    const title = titleFor(summary)
    // A prize is BBO's to show. The tally steps aside, into the tooltip.
    if (event.award > 0) {
      existing?.remove()
      last.title = title
      last.dataset.bcDdTitled = '1'
      continue
    }
    const key = tallyKey(summary)
    if (existing?.dataset.bcDdTally === key) continue
    existing?.remove()
    const el = doc.createElement('span')
    el.className = TALLY_CLASS
    el.dataset.bcDdTally = key
    el.title = title
    Object.assign(el.style, { fontSize: '0.85em', fontWeight: '600', whiteSpace: 'nowrap' })
    fillTally(doc, el, summary)
    inner.appendChild(el)
  }
}

/** The last column's header says DD and opens the menu. `text` also carries a
 *  run's progress. `onClick` null puts BBO's own label back. */
export function syncHeader(doc, { text = 'DD ▾', title = '', onClick }, isVisible = shown) {
  const list = visibleList(doc, isVisible)
  const cells = list?.querySelectorAll('.headerClass .cellClass')
  const last = cells?.length === COLUMNS ? cells[COLUMNS - 1] : null
  const inner = last?.querySelector('.innerClass')
  if (!inner) return null
  let el = last.querySelector(`.${HEADER_CLASS}`)
  if (!onClick) {
    el?.remove()
    inner.style.display = ''
    return null
  }
  if (!el) {
    el = doc.createElement('div')
    el.className = HEADER_CLASS
    el.style.marginLeft = inner.style.marginLeft
    el.style.marginRight = inner.style.marginRight
    el.style.cursor = 'pointer'
    el.style.whiteSpace = 'nowrap'
    inner.style.display = 'none'
    last.appendChild(el)
  }
  if (el.textContent !== text) el.textContent = text
  el.title = title
  el.onclick = (e) => {
    e.stopPropagation()
    onClick(el)
  }
  return el
}

/** The date ranges, each with how many of its events are still to do. Days are
 *  the user's own. */
export function menuRanges(now = new Date()) {
  // By the calendar, not by 24-hour days: the clocks change.
  const daysAgo = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n).getTime()
  return [
    { label: 'Today', since: daysAgo(0) },
    { label: 'Last 7 days', since: daysAgo(6) },
    { label: 'Last 30 days', since: daysAgo(29) },
    { label: 'Everything listed', since: null },
  ]
}

export function closeMenu(doc) {
  doc.getElementById(MENU_ID)?.remove()
}

/** Under `anchor`, one row per range. `items` is [{ label, count, inRange, onPick }]:
 *  `count` events to do, of a range that holds any at all. */
export function openMenu(doc, anchor, items) {
  closeMenu(doc)
  const box = anchor.getBoundingClientRect()
  const menu = doc.createElement('div')
  menu.id = MENU_ID
  Object.assign(menu.style, {
    position: 'fixed',
    top: `${box.bottom + 4}px`,
    right: `${Math.max(4, doc.documentElement.clientWidth - box.right)}px`,
    zIndex: '2147483646',
    minWidth: '220px',
    background: '#fff',
    color: '#222',
    border: '1px solid #bbb',
    borderRadius: '6px',
    boxShadow: '0 2px 10px rgba(0,0,0,.25)',
    font: '15px sans-serif',
    padding: '4px 0',
  })
  const head = doc.createElement('div')
  head.textContent = 'Analyse events'
  Object.assign(head.style, { padding: '4px 12px', fontSize: '12px', color: MUTED_FG })
  menu.appendChild(head)
  for (const { label, count, inRange, onPick } of items) {
    const row = doc.createElement('button')
    row.type = 'button'
    Object.assign(row.style, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '16px',
      width: '100%',
      padding: '7px 12px',
      border: 'none',
      background: 'none',
      font: 'inherit',
      color: count ? '#222' : '#aaa',
      cursor: count ? 'pointer' : 'default',
      textAlign: 'left',
    })
    row.disabled = !count
    const name = doc.createElement('span')
    name.textContent = label
    const n = doc.createElement('span')
    n.textContent = count ? `${count} to do` : inRange ? 'done' : 'none'
    n.style.color = count ? MUTED_FG : '#aaa'
    row.append(name, n)
    row.onclick = (e) => {
      e.stopPropagation()
      closeMenu(doc)
      onPick()
    }
    menu.appendChild(row)
  }
  doc.body.appendChild(menu)
  return menu
}

/** "DD all", above BBO's Results button on the event page. `onClick` null removes
 *  it. */
export function syncEventButton(doc, { text = 'DD all', title = '', onClick }, isVisible = shown) {
  const existing = doc.getElementById(EVENT_BUTTON_ID)
  const panel = [...doc.querySelectorAll('result-list')].find(isVisible)
  const results = panel?.querySelector('.resultsButtonClass')
  if (!results || !onClick) {
    existing?.remove()
    return null
  }
  let btn = existing
  if (!btn || btn.parentElement !== results.parentElement) {
    existing?.remove()
    btn = doc.createElement('button')
    btn.id = EVENT_BUTTON_ID
    btn.type = 'button'
    Object.assign(btn.style, {
      position: 'absolute',
      right: results.style.right || '5px',
      top: '4px',
      minWidth: '92px',
      height: '32px',
      padding: '0 8px',
      border: 'none',
      borderRadius: '4px',
      background: '#1a73e8',
      color: '#fff',
      font: '600 14px sans-serif',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    })
    results.parentElement.appendChild(btn)
  }
  if (btn.textContent !== text) btn.textContent = text
  btn.title = title
  btn.onclick = (e) => {
    e.stopPropagation()
    onClick()
  }
  return btn
}

export function clearHistory(doc) {
  closeMenu(doc)
  doc.getElementById(EVENT_BUTTON_ID)?.remove()
  for (const el of doc.querySelectorAll(`.${TALLY_CLASS}, .${HEADER_CLASS}`)) {
    const inner = el.classList.contains(HEADER_CLASS)
      ? el.parentElement?.querySelector('.innerClass')
      : null
    if (inner) inner.style.display = ''
    el.remove()
  }
  for (const cell of doc.querySelectorAll('[data-bc-dd-titled]')) {
    cell.removeAttribute('title')
    delete cell.dataset.bcDdTitled
  }
}
