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
const DATE_CLASS = 'bc-dd-date'
const DATE_HEADER_CLASS = 'bc-dd-date-header'
const SUMMARY_CLASS = 'bc-dd-summary'
// Elements of ours that stand in for a BBO cell's own text, which is hidden
// meanwhile and shown again when they go.
const STANDS_IN = [HEADER_CLASS, DATE_CLASS, DATE_HEADER_CLASS]
export const MENU_ID = 'bridge-craftwork-dd-menu'
// Extension storage: true when the first column shows dates.
export const DATES_KEY = 'dd-history-dates'
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

// A cell's own text, BBO's, whatever of ours sits beside it.
const ownText = (cell) => (cell.querySelector('.innerClass') ?? cell).textContent.trim()

function listRows(list) {
  return [...list.querySelectorAll('historic-tournament-list-item')]
    .map((row) => ({ row, cells: row.querySelectorAll('celled-rectangle .cellClass') }))
    .filter((r) => r.cells.length === COLUMNS)
}

/** Each row's event, or null. By position when the rows are BBO's list in order,
 *  which they are: every Weekly Free Instant Tournament is number 1, so the
 *  number alone cannot tell them apart. The rows may be fewer than the events,
 *  never out of step. Otherwise by a number only one event has. */
export function rowEvents(rows, events) {
  const all = events ?? []
  if (rows.length <= all.length && rows.every((r, i) => ownText(r.cells[0]) === all[i].number)) {
    return all.slice(0, rows.length)
  }
  const counts = new Map()
  for (const e of all) counts.set(e.number, (counts.get(e.number) ?? 0) + 1)
  const byNumber = new Map(all.filter((e) => counts.get(e.number) === 1).map((e) => [e.number, e]))
  return rows.map((r) => byNumber.get(ownText(r.cells[0])) ?? null)
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
  const rows = listRows(list)
  const byRow = rowEvents(rows, events)

  for (const [i, { cells }] of rows.entries()) {
    const event = byRow[i]
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

// ── Dates in place of the event number ───────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sun" within the past week, "8-Nov" within the past year, "8-Nov-2025" before
 *  that. By the user's own calendar. */
export function formatEventDate(ms, now = new Date()) {
  const d = new Date(ms)
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
  if (ms >= weekStart) return DAYS[d.getDay()]
  const dayMonth = `${d.getDate()}-${MONTHS[d.getMonth()]}`
  const yearStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1).getTime()
  return ms >= yearStart ? dayMonth : `${dayMonth}-${d.getFullYear()}`
}

// Our element in `cell`, standing in for BBO's text; null `text` takes it away.
function standIn(doc, cell, className, text, title = '') {
  const inner = cell.querySelector('.innerClass')
  let el = cell.querySelector(`.${className}`)
  if (text === null || !inner) {
    el?.remove()
    if (inner) inner.style.display = ''
    return null
  }
  if (!el) {
    el = doc.createElement('div')
    el.className = className
    el.style.marginLeft = inner.style.marginLeft
    el.style.marginRight = inner.style.marginRight
    el.style.whiteSpace = 'nowrap'
    inner.style.display = 'none'
    cell.appendChild(el)
  }
  if (el.textContent !== text) el.textContent = text
  el.title = title
  return el
}

/** The first column: BBO's event number, or with `dates` each event's date. Its
 *  header cell switches between the two; `onToggle` null puts it all back. */
export function syncDates(doc, events, { dates, onToggle, now = new Date() }, isVisible = shown) {
  const list = visibleList(doc, isVisible)
  if (!list) return
  const head = list.querySelectorAll('.headerClass .cellClass')
  if (head.length === COLUMNS) {
    const label = onToggle ? (dates ? 'Date ⇄' : '# ⇄') : null
    const el = standIn(
      doc,
      head[0],
      DATE_HEADER_CLASS,
      label,
      dates ? 'Show event numbers' : 'Show dates'
    )
    if (el) {
      el.style.cursor = 'pointer'
      el.onclick = (e) => {
        e.stopPropagation()
        onToggle()
      }
    }
  }
  const rows = listRows(list)
  const byRow = rowEvents(rows, events)
  for (const [i, { cells }] of rows.entries()) {
    const started = byRow[i]?.started
    const show = onToggle && dates && started
    standIn(
      doc,
      cells[0],
      DATE_CLASS,
      show ? formatEventDate(started, now) : null,
      show ? new Date(started).toLocaleString() : ''
    )
  }
}

// ── The summary row ──────────────────────────────────────────────────────────

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/** What the summary row says, from the rows listed and the tallies:
 *  { count, imps, pct, impEvents, pctEvents, rank, points, dd, ddEvents }, imps
 *  and pct unrounded (scoreText rounds them). Each
 *  average is over the events that have that figure; dd only over events whose
 *  every board is analysed, so a half-done event does not pull it down. */
export function summarizeList(rows, events, tallies) {
  const byRow = rowEvents(rows, events)
  const imps = []
  const pct = []
  const ranks = []
  let points = 0
  const dd = []
  for (const [i, { cells }] of rows.entries()) {
    const score = ownText(cells[2])
    const imp = /^(-?\d+(?:\.\d+)?)\s*IMP/i.exec(score)
    const mp = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(score)
    if (imp) imps.push(Number(imp[1]))
    else if (mp) pct.push(Number(mp[1]))
    const rank = Number.parseInt(ownText(cells[3]), 10)
    if (Number.isFinite(rank)) ranks.push(rank)
    const pts = Number.parseFloat(ownText(cells[4]))
    if (Number.isFinite(pts)) points += pts
    const s = byRow[i] ? tallySummary(tallies.get(byRow[i].tkey)) : null
    if (s && s.total > 0 && !s.partial) dd.push(s)
  }
  return {
    count: rows.length,
    imps: imps.length ? mean(imps) : null,
    impEvents: imps.length,
    pct: pct.length ? mean(pct) : null,
    pctEvents: pct.length,
    rank: ranks.length ? Math.round(mean(ranks)) : null,
    points,
    dd: dd.length
      ? {
          me: Math.round(mean(dd.map((s) => s.me))),
          partner: Math.round(mean(dd.map((s) => s.partner))),
          opps: Math.round(mean(dd.map((s) => s.opps))),
        }
      : null,
    ddEvents: dd.length,
  }
}

/** The average score: "3 IMP / 51%" when the list holds both kinds, whole
 *  numbers to fit; one decimal when it holds only one, "53.4%" or "2.7 IMP". */
export function scoreText(imps, pct) {
  if (imps !== null && pct !== null) return `${Math.round(imps)} IMP / ${Math.round(pct)}%`
  if (imps !== null) return `${imps.toFixed(1)} IMP`
  if (pct !== null) return `${pct.toFixed(1)}%`
  return ''
}

/** A row under the header with the count and averages of the events listed. */
export function drawSummary(doc, events, tallies, isVisible = shown) {
  const list = visibleList(doc, isVisible)
  const header = list?.querySelector('.headerClass')
  const head = header?.querySelectorAll('.cellClass')
  let el = list?.querySelector(`.${SUMMARY_CLASS}`)
  const rows = list ? listRows(list) : []
  if (!header || head.length !== COLUMNS || !rows.length) {
    el?.remove()
    return null
  }
  const s = summarizeList(rows, events, tallies)
  const score = scoreText(s.imps, s.pct)
  const cellsOut = [
    { text: 'Avg' },
    { text: `${s.count} event${s.count === 1 ? '' : 's'}` },
    {
      text: score,
      title: [
        s.imps !== null
          ? `${s.imps.toFixed(2)} IMPs on average over ${s.impEvents} IMP events`
          : null,
        s.pct !== null
          ? `${s.pct.toFixed(2)}% on average over ${s.pctEvents} matchpoint events`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { text: s.rank !== null ? String(s.rank) : '', title: 'Average rank' },
    { text: s.points ? s.points.toFixed(2) : '', title: 'Total points' },
    {
      dd: s.dd,
      title: s.dd
        ? `Double-dummy errors per event, you-partner-opponents: the average over the ${s.ddEvents} events fully analysed.`
        : 'No event fully analysed yet',
    },
  ]
  const key = JSON.stringify(cellsOut)
  if (el?.dataset.bcDdSummary === key && el.previousElementSibling === header) return el
  el?.remove()
  el = doc.createElement('div')
  el.className = SUMMARY_CLASS
  el.dataset.bcDdSummary = key
  Object.assign(el.style, {
    display: 'flex',
    background: 'rgb(226, 236, 226)',
    color: 'rgb(20, 20, 20)',
    borderBottom: '1px solid gray',
  })
  for (const [i, out] of cellsOut.entries()) {
    const cell = doc.createElement('div')
    cell.style.cssText = head[i].style.cssText
    cell.style.fontWeight = '600'
    cell.style.overflow = 'hidden'
    cell.style.whiteSpace = 'nowrap'
    const inner = doc.createElement('div')
    const theirs = head[i].querySelector('.innerClass')
    inner.style.marginLeft = theirs?.style.marginLeft ?? '3px'
    inner.style.marginRight = theirs?.style.marginRight ?? '3px'
    if (out.dd) {
      fillTally(doc, inner, { ...out.dd, total: 1, partial: false })
    } else {
      inner.textContent = out.text
    }
    if (out.title) cell.title = out.title
    cell.appendChild(inner)
    el.appendChild(cell)
  }
  header.after(el)
  return el
}

export function clearHistory(doc) {
  closeMenu(doc)
  doc.getElementById(EVENT_BUTTON_ID)?.remove()
  doc.querySelector(`.${SUMMARY_CLASS}`)?.remove()
  for (const el of doc.querySelectorAll(
    [TALLY_CLASS, ...STANDS_IN].map((c) => `.${c}`).join(', ')
  )) {
    const inner = STANDS_IN.some((c) => el.classList.contains(c))
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
