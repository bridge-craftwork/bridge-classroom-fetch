import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseArdDeals,
  parseBoardDetails,
  resultOf,
  resultOfLin,
} from '../../../src/adapters/bbo/parsers/liveXml.js'
import { parseLin, parseLinPlayers, deriveContract } from '../../../src/adapters/bbo/parsers/lin.js'
import { buildPlayRequest } from '../../../src/lib/ddPlay.js'

const fixture = (name) =>
  readFileSync(join(import.meta.dirname, '../../../fixtures/bbo', name), 'utf8')

// A real <sc_board_details> from BBO's game connection, board 16 of a live
// #52031, 6 Nov 2026, as kemistry (East). The other names are replaced.
const xml = fixture('ws-board-details-52031-b16.xml')

describe('parseBoardDetails', () => {
  const board = parseBoardDetails(xml)
  const lin = parseLin(board.lin)

  it('keys the board by its request', () => {
    expect(board.hk).toBe('live:d~t~52031~1~16~0')
    expect(board.number).toBe(16)
  })

  it('turns the deal into LIN, ranks in order', () => {
    expect(board.lin).toContain('md|2SAK872HAQJD982CJ4,')
    expect(lin.dealer).toBe('W')
    expect(lin.vulnerability).toBe('EW')
    expect(lin.deal.E.H).toEqual(['10', '9', '8', '7', '5', '3'])
  })

  it('keeps who sat where', () => {
    expect(parseLinPlayers(board.lin)).toEqual({
      N: 'north-player',
      E: 'kemistry',
      S: 'south-player',
      W: 'west-player',
    })
  })

  it('keeps the auction, alerts and explanations', () => {
    expect(lin.auction).toEqual(['1D', 'PASS', '2H', '2S', 'X', 'PASS', 'PASS', 'PASS'])
    expect(board.lin).toContain('mb|2H!|an|weak|')
    expect(deriveContract(lin.auction, lin.dealer)).toEqual({ contract: '2SX', declarer: 'S' })
  })

  it('keeps all 52 cards, in order, ready for the solver', () => {
    expect(lin.play).toHaveLength(52)
    expect(lin.play.slice(0, 4)).toEqual(['CA', 'C3', 'C6', 'C4'])
    const { request } = buildPlayRequest(board.lin)
    expect(request.declarer).toBe('S')
    expect(request.leader).toBe('W')
    expect(request.plays).toHaveLength(52)
  })

  it('refuses what it does not recognise', () => {
    expect(() => parseBoardDetails('<sc_chat/>')).toThrow(/expected <sc_board_details>/)
    expect(() => parseBoardDetails(xml.replace('S278KA', 'S278K'))).toThrow(/52 cards/)
    expect(() => parseBoardDetails('<sc_board_details request_id="x"')).toThrow(/well-formed/)
  })
})

describe('the result, as History writes it', () => {
  it('reads a played-out board', () => {
    // 2S doubled by South, nine tricks, worked out from the 52 cards.
    expect(resultOfLin(parseBoardDetails(xml).lin)).toBe('2SSx+1')
  })

  it('writes made, over and under', () => {
    expect(resultOf({ contract: '4H', declarer: 'W', tricksWon: 10 })).toBe('4HW=')
    expect(resultOf({ contract: '3NT', declarer: 'S', tricksWon: 11 })).toBe('3NS+2')
    expect(resultOf({ contract: '5HX', declarer: 'N', tricksWon: 7 })).toBe('5HNx-4')
    expect(resultOf({ contract: null, declarer: null, tricksWon: 0 })).toBeNull()
  })
})

describe('parseArdDeals', () => {
  const xml = fixture('ard-deals-daylong.xml')

  it('reads every board of a daylong, with names, result and a key per board', () => {
    const { tid, boards } = parseArdDeals(xml)
    expect(tid).toBe('9ca06e6d-da89-11f1-8901-ac1f6b5a106e')
    expect(boards.map((b) => b.number)).toEqual([1, 2, 3, 4])
    expect(boards.map((b) => b.result)).toEqual(['4HE-1', 'P', '3CE=', '4CS-1'])
    expect(boards[3].players).toEqual({ N: '~robot', E: '~robot', S: 'kemistry', W: '~robot' })
    expect(new Set(boards.map((b) => b.hk)).size).toBe(4)
  })

  it('gives LIN the rest of the extension reads as it reads History', () => {
    const b4 = parseArdDeals(xml).boards[3]
    const parsed = parseLin(b4.lin)
    expect(parseLinPlayers(b4.lin).S).toBe('kemistry')
    expect(parsed.dealer).toBe('W')
    expect(parsed.vulnerability).toBe('Both')
    expect(parsed.deal.S.C.join('')).toBe('AKQ10642')
    expect(parsed.play).toHaveLength(28)
    expect(parsed.tricks).toBe(9)
    expect(deriveContract(parsed.auction, parsed.dealer)).toMatchObject({
      contract: '4C',
      declarer: 'S',
    })
  })

  it('reads vulnerability 0 as none and a passed-out board as no contract', () => {
    const [b1, b2] = parseArdDeals(xml).boards
    expect(parseLin(b1.lin).vulnerability).toBe('None')
    expect(deriveContract(parseLin(b2.lin).auction, parseLin(b2.lin).dealer).contract).toBeFalsy()
  })

  it('refuses another answer of ard.php rather than reading it as no boards', () => {
    expect(() => parseArdDeals('<events err="0"><sc_card_played card="HK"/></events>')).toThrow(
      /expected <deals>/
    )
    expect(() => parseArdDeals('<deals err="0"/>')).toThrow(/no tid/)
  })
})
