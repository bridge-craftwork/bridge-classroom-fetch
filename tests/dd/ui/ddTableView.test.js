import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  drawDdTable,
  clearDdTables,
  resultParts,
  syncResult,
  DD_TABLE_CLASS,
  OWNS_CLASS,
  RESULT_ID,
} from '../../../src/dd/ui/ddTableView.js'

const html = readFileSync(
  join(import.meta.dirname, '../../../fixtures/bbo/v3-history-33873-board1.html'),
  'utf8'
)

// Board 1 of #33873, as the background answers: 3NT by South, par "NS 3N+1".
const table1 = {
  tricks: [
    [10, 10, 9, 8, 10],
    [3, 3, 4, 5, 3],
    [10, 10, 9, 8, 10],
    [3, 3, 4, 5, 3],
  ],
  par: 'NS 3N+1',
  parScore: 'NS 430',
}

let doc, viewer
beforeEach(() => {
  doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  // The viewer showing board 1, not BBO's hidden copy with empty hands.
  viewer = [...doc.querySelectorAll('deal-viewer')].find((v) =>
    v.querySelector('hand-diagram-card')
  )
})

// BBO Helper's table, as it adds it to the felt.
function addBboHelper(v) {
  const theirs = doc.createElement('div')
  theirs.className = 'bhDoubleDummy'
  v.querySelector('.coverClass').appendChild(theirs)
  return theirs
}

const cells = () => [...doc.querySelectorAll(`.${DD_TABLE_CLASS} td`)]

describe('the double-dummy table', () => {
  it("draws Bridge Classroom's grid on the felt, a pair that agrees on one row", () => {
    expect(drawDdTable(doc, viewer, table1, { contract: '3NT', declarer: 'S' })).toBe(true)
    const box = viewer.querySelector(`.coverClass > .${DD_TABLE_CLASS}`)
    expect(box).not.toBeNull()
    const heads = [...box.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['', '♣', '♦', '♥', '♠', 'NT'])
    const seats = [...box.querySelectorAll('tbody th')].map((th) => th.textContent)
    expect(seats).toEqual(['NS', 'EW'])
    expect(cells().map((td) => td.textContent)).toEqual([
      '10',
      '10',
      '9',
      '8',
      '10',
      '3',
      '3',
      '4',
      '5',
      '3',
    ])
  })

  it('marks the contract green and par bold; here they are the same cell', () => {
    drawDdTable(doc, viewer, table1, { contract: '3NT', declarer: 'S' })
    const nt = cells()[4]
    expect(nt.dataset.bcDdContract).toBe('1')
    expect(nt.dataset.bcDdPar).toBe('1')
    expect(nt.style.fontWeight).toBe('700')
    expect(nt.style.background).not.toBe('')
    expect(cells()[0].style.fontWeight).toBe('400')
    expect(nt.title).toMatch(/makes 3NT with 1 over — par/)
  })

  it('leaves the contract un-bolded when it is not par, so the two never read alike', () => {
    drawDdTable(doc, viewer, { ...table1, par: 'EW 4S=' }, { contract: '3NT', declarer: 'S' })
    const nt = cells()[4]
    expect(nt.dataset.bcDdContract).toBe('1')
    expect(nt.style.fontWeight).toBe('400')
    expect(cells()[8].dataset.bcDdPar).toBe('1') // EW spades
  })

  it("hides BBO Helper's table while ours is drawn, and gives it back after", () => {
    addBboHelper(viewer)
    drawDdTable(doc, viewer, table1, { contract: '3NT', declarer: 'S' })
    expect(viewer.classList.contains(OWNS_CLASS)).toBe(true)
    expect(doc.getElementById('bc-dd-table-style').textContent).toContain(
      `.${OWNS_CLASS} .bhDoubleDummy { display: none !important; }`
    )
    clearDdTables(doc)
    expect(viewer.classList.contains(OWNS_CLASS)).toBe(false)
    expect(doc.querySelector(`.${DD_TABLE_CLASS}`)).toBeNull()
    expect(doc.querySelector('.bhDoubleDummy')).not.toBeNull()
  })

  it('redraws nothing when nothing has changed', () => {
    drawDdTable(doc, viewer, table1, { contract: '3NT', declarer: 'S' })
    const first = doc.querySelector(`.${DD_TABLE_CLASS} table`)
    drawDdTable(doc, viewer, table1, { contract: '3NT', declarer: 'S' })
    expect(doc.querySelector(`.${DD_TABLE_CLASS} table`)).toBe(first)
  })

  it("draws nothing, and leaves BBO Helper's, without a table or in pictures of cards", () => {
    expect(drawDdTable(doc, viewer, null)).toBe(false)
    expect(doc.querySelector(`.${DD_TABLE_CLASS}`)).toBeNull()
    for (const p of viewer.querySelectorAll('.handDiagramPanelClass')) p.style.display = 'none'
    expect(drawDdTable(doc, viewer, table1)).toBe(false)
    expect(viewer.classList.contains(OWNS_CLASS)).toBe(false)
  })

  it("hides BBO Helper's at once while ours is on its way, and gives it back if none comes", () => {
    addBboHelper(viewer)
    expect(drawDdTable(doc, viewer, null, { pending: true })).toBe(false)
    expect(viewer.classList.contains(OWNS_CLASS)).toBe(true)
    expect(doc.querySelector(`.${DD_TABLE_CLASS}`)).toBeNull()
    drawDdTable(doc, viewer, null, { pending: false })
    expect(viewer.classList.contains(OWNS_CLASS)).toBe(false)
  })
})

describe('the result at this table', () => {
  it("reads History's text with the suit glyph, and nothing else", () => {
    const text = (r) =>
      resultParts(r)
        ?.map((p) => p.text)
        .join('')
    expect(text('4HE+1')).toBe('4♥E+1')
    expect(text('3NS=')).toBe('3NTS=')
    expect(text('5HNx-2')).toBe('5♥Nx-2')
    expect(resultParts('4HE+1')[1].color).toBe('#d32f2f')
    expect(resultParts('P')).toBeNull()
    expect(resultParts(null)).toBeNull()
  })

  it("sits level with BBO's menu, left of it, and goes when there is none", () => {
    const box = syncResult(doc, viewer, '4HE+1')
    expect(box.id).toBe(RESULT_ID)
    expect(box.textContent).toBe('4♥E+1')
    const menu = viewer.querySelector('.moreClass')
    expect(box.parentElement).toBe(menu.parentElement)
    expect(box.style.top).toBe(menu.style.top)
    expect(Number.parseFloat(box.style.left)).toBeLessThan(Number.parseFloat(menu.style.left))
    expect(syncResult(doc, viewer, '4HE+1')).toBe(box)
    syncResult(doc, viewer, null)
    expect(doc.getElementById(RESULT_ID)).toBeNull()
  })
})
