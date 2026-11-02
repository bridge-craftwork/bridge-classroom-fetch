import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTfind } from '../../src/adapters/bbo/parsers/mhXml.js'
import {
  clearHistory,
  drawTallies,
  menuRanges,
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
    (r) => r.querySelector('.cellClass').textContent.trim() === number
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

  it('does not tie a row to a number two events share', () => {
    const twice = [...events, { ...events[0], tkey: '33879-1' }]
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
