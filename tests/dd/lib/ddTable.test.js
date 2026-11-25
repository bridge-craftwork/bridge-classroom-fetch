import { describe, it, expect } from 'vitest'
import {
  buildDdRows,
  collapseDdRows,
  parseParContracts,
  cellTitle,
  contractTarget,
} from '../../../src/dd/lib/ddTable.js'

// Fixture board 1 (mh-hand-33873-board1.xml), as the solver answers: rows
// N, E, S, W; columns C, D, H, S, NT. 3NT by South; par "NS 3N+1".
const BOARD1 = [
  [10, 10, 9, 8, 10],
  [3, 3, 4, 5, 3],
  [10, 10, 9, 8, 10],
  [3, 3, 4, 5, 3],
]
// Board 5: 6S by North; par "EW 7HX-4", a sacrifice. East and West differ in clubs.
const BOARD5 = [
  [7, 12, 4, 12, 6],
  [5, 1, 9, 1, 5],
  [7, 12, 4, 12, 6],
  [6, 1, 9, 1, 5],
]

const marked = (rows, key) =>
  rows.flatMap((r) => r.cells.map((c, i) => (c[key] ? `${r.seat}${i}` : null))).filter(Boolean)

describe('parseParContracts', () => {
  it('reads a pair, a single seat, a sacrifice and ties', () => {
    expect(parseParContracts('NS 3N+1')).toEqual([
      { seats: ['N', 'S'], strain: 4, contract: '3NT' },
    ])
    expect(parseParContracts('N 3N=')).toEqual([{ seats: ['N'], strain: 4, contract: '3NT' }])
    expect(parseParContracts('EW 7HX-4')).toEqual([
      { seats: ['E', 'W'], strain: 2, contract: '7HX' },
    ])
    expect(parseParContracts('NS 4S=; NS 5C=').map((p) => p.strain)).toEqual([3, 0])
  })
  it('has nothing for a passed-out deal, or text it cannot read', () => {
    expect(parseParContracts(null)).toEqual([])
    expect(parseParContracts('')).toEqual([])
    expect(parseParContracts('pass')).toEqual([])
  })
})

describe('buildDdRows', () => {
  it('reads partners adjacent, N S E W, and marks the contract and par', () => {
    const rows = buildDdRows(BOARD5, { contract: '6S', declarer: 'N', par: 'EW 7HX-4' })
    expect(rows.map((r) => r.seat)).toEqual(['N', 'S', 'E', 'W'])
    expect(rows[3].cells.map((c) => c.tricks)).toEqual([6, 1, 9, 1, 5])
    expect(marked(rows, 'isContract')).toEqual(['N3'])
    expect(marked(rows, 'isPar')).toEqual(['E2', 'W2'])
  })
  it('marks the same cell both ways when the contract is par', () => {
    const rows = buildDdRows(BOARD1, { contract: '3NT', declarer: 'S', par: 'NS 3N+1' })
    expect(marked(rows, 'isContract')).toEqual(['S4'])
    expect(marked(rows, 'isPar')).toEqual(['N4', 'S4'])
  })
  it('marks only the seat named when par is one partner', () => {
    expect(marked(buildDdRows(BOARD1, { par: 'N 3N=' }), 'isPar')).toEqual(['N4'])
  })
  it('marks no contract for a passed-out board', () => {
    expect(marked(buildDdRows(BOARD1, { contract: null }), 'isContract')).toEqual([])
  })
  it('draws nothing from a malformed table, rather than confident zeros', () => {
    expect(buildDdRows(null)).toBeNull()
    expect(buildDdRows(BOARD1.slice(0, 3))).toBeNull()
    expect(buildDdRows([[1, 2, 3, 4], ...BOARD1.slice(1)])).toBeNull()
    expect(buildDdRows([[14, 0, 0, 0, 0], ...BOARD1.slice(1)])).toBeNull()
  })
})

describe('collapseDdRows', () => {
  it('merges a pair whose tricks all match, keeping both marks', () => {
    const rows = collapseDdRows(
      buildDdRows(BOARD1, { contract: '3NT', declarer: 'S', par: 'NS 3N+1' })
    )
    expect(rows.map((r) => r.seat)).toEqual(['NS', 'EW'])
    expect(rows[0].cells[4]).toEqual({ tricks: 10, isContract: true, isPar: true })
  })
  it('keeps a pair apart when any cell differs', () => {
    const rows = collapseDdRows(buildDdRows(BOARD5, { par: 'EW 7HX-4' }))
    expect(rows.map((r) => r.seat)).toEqual(['NS', 'E', 'W'])
  })
})

describe('cellTitle', () => {
  it('reads the contract cell as made or beaten, and says par', () => {
    const cell = { tricks: 10, isContract: true, isPar: true }
    expect(cellTitle('NS', 4, cell, '3NT')).toBe(
      'North and South take 10 tricks in notrump — makes 3NT with 1 over — par'
    )
    expect(cellTitle('N', 3, { tricks: 12, isContract: true, isPar: false }, '6S')).toBe(
      'North takes 12 tricks in spades — exactly makes 6S'
    )
    expect(contractTarget('6S')).toBe(12)
  })
})
