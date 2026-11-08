import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTfind } from '../../src/adapters/bbo/parsers/mhXml.js'
import {
  clearHistory,
  drawSummary,
  drawTallies,
  formatEventDate,
  menuRanges,
  scoreText,
  summarizeList,
  syncDates,
  syncEventButton,
  syncHeader,
  tallySummary,
} from '../../src/ui/ddHistory.js'

const root = join(import.meta.dirname, '../..')
const html = readFileSync(join(root, 'fixtures/bbo/v3-history-list.html'), 'utf8')
const events = parseTfind(readFileSync(join(root, 'fixtures/bbo/tfind-kemistry.xml'), 'utf8'))
const visible = () => true

const rowFor = (doc, number) =>
  [...doc.querySelectorAll('historic-tournament-list-item')].find(
    (r) => r.querySelector('.cellClass .innerClass').textContent.trim() === number
  )
const lastCell = (row) => [...row.querySelectorAll('celled-rectangle .cellClass')].at(-1)

describe('tallySummary', () => {
  it('adds up the boards', () => {
    const s = tallySummary({ total: 2, b: { 1: [1, 0, 2], 2: [0, 1, 1] } })
    expect(s).toMatchObject({ me: 1, partner: 1, opps: 3, partial: false })
  })
  it('marks an event with boards still to do', () => {
    expect(tallySummary({ total: 3, b: { 1: [1, 0, 2] } }).partial).toBe(true)
  })
  it('has nothing to say about an event with no board analysed', () => {
    expect(tallySummary(undefined)).toBeNull()
    expect(tallySummary({ total: 12, b: {} })).toBeNull()
  })
})

describe('drawing on the list', () => {
  let doc
  beforeEach(() => {
    doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  })

  it("writes me-partner-opps into the row's last cell", () => {
    const tallies = new Map([['33879-1793552400', { total: 2, b: { 1: [1, 0, 3], 2: [0, 0, 0] } }]])
    drawTallies(doc, events, tallies, visible)
    expect(lastCell(rowFor(doc, '33879')).textContent.trim()).toBe('1-0-3')
  })

  it('adds * when boards are still to do', () => {
    const tallies = new Map([['33879-1793552400', { total: 12, b: { 1: [1, 0, 3] } }]])
    drawTallies(doc, events, tallies, visible)
    expect(lastCell(rowFor(doc, '33879')).textContent.trim()).toBe('1-0-3*')
  })

  it('leaves an event never opened blank', () => {
    drawTallies(doc, events, new Map(), visible)
    expect(lastCell(rowFor(doc, '33879')).textContent.trim()).toBe('')
  })

  it('shows a dash for an event with no boards at all', () => {
    const tallies = new Map([['33879-1793552400', { total: 0, b: {} }]])
    drawTallies(doc, events, tallies, visible)
    expect(lastCell(rowFor(doc, '33879')).textContent.trim()).toBe('–')
  })

  it('leaves a real prize showing, with the tally in its tooltip', () => {
    const prized = events.map((e) => (e.number === '33879' ? { ...e, award: 1.5 } : e))
    const cell = lastCell(rowFor(doc, '33879'))
    cell.querySelector('.innerClass').textContent = '1.50 BB$'
    const tallies = new Map([['33879-1793552400', { total: 1, b: { 1: [1, 0, 3] } }]])
    drawTallies(doc, prized, tallies, visible)
    expect(cell.textContent.trim()).toBe('1.50 BB$')
    expect(cell.title).toMatch(/you 1, partner 0, opponents 3/)
    clearHistory(doc)
    expect(cell.hasAttribute('title')).toBe(false)
  })

  it('does not tie a row to a number two events share, when the rows are out of step', () => {
    const twice = [{ ...events[0], tkey: '33879-1' }, ...events]
    const tallies = new Map([['33879-1793552400', { total: 1, b: { 1: [1, 0, 3] } }]])
    drawTallies(doc, twice, tallies, visible)
    expect(lastCell(rowFor(doc, '33879')).textContent.trim()).toBe('')
  })

  it('does not change what is already right', () => {
    const tallies = new Map([['33879-1793552400', { total: 1, b: { 1: [1, 0, 3] } }]])
    drawTallies(doc, events, tallies, visible)
    const el = doc.querySelector('.bc-dd-tally')
    drawTallies(doc, events, tallies, visible)
    expect(doc.querySelector('.bc-dd-tally')).toBe(el)
  })

  it('relabels the header, and hiding puts Prize back', () => {
    const headerCell = () => [...doc.querySelectorAll('.headerClass .cellClass')].at(-1)
    syncHeader(doc, { onClick: () => {} }, visible)
    expect(headerCell().querySelector('.bc-dd-history-header').textContent).toBe('DD ▾')
    expect(headerCell().querySelector('.innerClass').style.display).toBe('none')
    const tallies = new Map([['33879-1793552400', { total: 1, b: { 1: [1, 0, 3] } }]])
    drawTallies(doc, events, tallies, visible)
    clearHistory(doc)
    expect(headerCell().textContent.trim()).toBe('Prize')
    expect(headerCell().querySelector('.innerClass').style.display).toBe('')
    expect(doc.querySelector('.bc-dd-tally')).toBeNull()
  })

  it('opens the menu from the header', () => {
    let opened = null
    const el = syncHeader(doc, { onClick: (a) => (opened = a) }, visible)
    el.click()
    expect(opened).toBe(el)
  })

  it('leaves a list of another shape alone', () => {
    doc.querySelector('.headerClass .cellClass').remove()
    expect(syncHeader(doc, { onClick: () => {} }, visible)).toBeNull()
    expect(doc.querySelector('.bc-dd-history-header')).toBeNull()
  })
})

describe('the event button', () => {
  it('sits beside Results, and goes when there is nothing to do', () => {
    const doc = new DOMParser().parseFromString(
      '<!doctype html><body><result-list><div class="tourneyClass"><button class="resultsButtonClass">Results:</button></div></result-list></body>',
      'text/html'
    )
    const btn = syncEventButton(doc, { onClick: () => {} }, visible)
    expect(btn.parentElement.className).toBe('tourneyClass')
    expect(btn.textContent).toBe('DD all')
    syncEventButton(doc, { onClick: null }, visible)
    expect(doc.getElementById(btn.id)).toBeNull()
  })
})

describe('menuRanges', () => {
  it("counts days from the user's own midnight", () => {
    const now = new Date(2026, 10, 2, 15, 30)
    const [today, week, month, all] = menuRanges(now)
    expect(today.since).toBe(new Date(2026, 10, 2).getTime())
    expect(week.since).toBe(new Date(2026, 9, 27).getTime())
    expect(month.since).toBe(new Date(2026, 9, 4).getTime())
    expect(all.since).toBeNull()
  })
})

describe('formatEventDate', () => {
  const now = new Date(2026, 10, 8, 15, 0) // Sunday 8 Nov 2026
  it('names the day within the past week', () => {
    expect(formatEventDate(new Date(2026, 10, 8, 9, 28).getTime(), now)).toBe('Sun')
    expect(formatEventDate(new Date(2026, 10, 2, 0, 1).getTime(), now)).toBe('Mon')
  })
  it('gives day and month within the past year, and the year before that', () => {
    expect(formatEventDate(new Date(2026, 10, 1, 11, 0).getTime(), now)).toBe('1-Nov')
    expect(formatEventDate(new Date(2025, 10, 9, 11, 0).getTime(), now)).toBe('9-Nov')
    expect(formatEventDate(new Date(2025, 10, 8, 11, 0).getTime(), now)).toBe('8-Nov-2025')
  })
})

describe('the date column and the summary row', () => {
  let doc
  beforeEach(() => {
    doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  })
  const firstCell = (row) => row.querySelector('celled-rectangle .cellClass')
  const headFirst = () => doc.querySelector('.headerClass .cellClass')
  const now = new Date(2026, 10, 2, 12, 0)

  it('shows dates when asked, numbers otherwise, and switches from the header', () => {
    let toggled = 0
    syncDates(doc, events, { dates: true, onToggle: () => toggled++, now }, visible)
    const cell = firstCell(rowFor(doc, '33879'))
    expect(cell.querySelector('.bc-dd-date').textContent).toBe('Sun')
    expect(cell.querySelector('.innerClass').style.display).toBe('none')
    headFirst().querySelector('.bc-dd-date-header').click()
    expect(toggled).toBe(1)
    syncDates(doc, events, { dates: false, onToggle: () => {}, now }, visible)
    expect(cell.querySelector('.bc-dd-date')).toBeNull()
    expect(cell.textContent.trim()).toBe('33879')
    expect(headFirst().querySelector('.bc-dd-date-header').textContent).toBe('# ⇄')
  })

  it('still finds each row with dates showing', () => {
    syncDates(doc, events, { dates: true, onToggle: () => {}, now }, visible)
    const tallies = new Map([['33879-1793552400', { total: 1, b: { 1: [1, 0, 3] } }]])
    drawTallies(doc, events, tallies, visible)
    expect(lastCell(rowFor(doc, '33879')).textContent.trim()).toBe('1-0-3')
  })

  it('ties rows to events by position, so events sharing a number each get theirs', () => {
    const rows = [...doc.querySelectorAll('historic-tournament-list-item')]
    for (const r of rows) firstCell(r).querySelector('.innerClass').textContent = '1'
    const ones = events.map((e) => ({ ...e, number: '1' }))
    const tallies = new Map([[ones[1].tkey, { total: 1, b: { 1: [2, 0, 0] } }]])
    drawTallies(doc, ones, tallies, visible)
    expect(lastCell(rows[1]).textContent.trim()).toBe('2-0-0')
    expect(lastCell(rows[0]).textContent.trim()).toBe('')
  })

  it('averages what is listed', () => {
    const rows = [...doc.querySelectorAll('historic-tournament-list-item')].map((row) => ({
      row,
      cells: row.querySelectorAll('celled-rectangle .cellClass'),
    }))
    const tallies = new Map([
      [events[0].tkey, { total: 1, b: { 1: [1, 2, 3] } }],
      [events[1].tkey, { total: 1, b: { 1: [2, 2, 6] } }],
      [events[2].tkey, { total: 5, b: { 1: [9, 9, 9] } }], // partial: left out
    ])
    const s = summarizeList(rows, events, tallies)
    expect(s.count).toBe(rows.length)
    expect(s.dd).toEqual({ me: 2, partner: 2, opps: 5 })
    expect(s.ddEvents).toBe(2)
    expect(s.imps === null && s.pct === null).toBe(false)
  })

  it('puts the summary under the header, once, and hiding takes it away', () => {
    const el = drawSummary(doc, events, new Map(), visible)
    expect(el.previousElementSibling.classList.contains('headerClass')).toBe(true)
    expect(el.children.length).toBe(6)
    expect(el.children[0].textContent).toBe('Avg')
    expect(drawSummary(doc, events, new Map(), visible)).toBe(el)
    syncDates(doc, events, { dates: true, onToggle: () => {}, now }, visible)
    clearHistory(doc)
    expect(doc.querySelector('.bc-dd-summary')).toBeNull()
    expect(doc.querySelector('.bc-dd-date')).toBeNull()
    expect(headFirst().textContent.trim()).toBe('#')
  })
})

describe('scoreText', () => {
  it('rounds to whole numbers when both kinds are listed', () => {
    expect(scoreText(2.6, 51.4)).toBe('3 IMP / 51%')
  })
  it('keeps a decimal when only one kind is', () => {
    expect(scoreText(null, 53.44)).toBe('53.4%')
    expect(scoreText(-2.66, null)).toBe('-2.7 IMP')
    expect(scoreText(null, null)).toBe('')
  })
})
