import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPlayRequest, summarizeTrace, seatOf, solverCard } from '../../src/lib/ddPlay.js'
import { parseMhHand } from '../../src/adapters/bbo/parsers/mhXml.js'

const lin = (n) =>
  parseMhHand(
    readFileSync(
      join(import.meta.dirname, `../../fixtures/bbo/mh-hand-33873-board${n}.xml`),
      'utf8'
    )
  ).lin

describe('buildPlayRequest', () => {
  it('board 1: 3NT by South, West on lead, all 52 cards', () => {
    const built = buildPlayRequest(lin(1))
    expect(built.contract).toBe('3NT')
    expect(built.declarer).toBe('S')
    expect(built.request).toEqual({
      dealstr: 'N:83.93.KT84.AQ982 Q92.J852.J97.T74 AT65.KT64.AQ.KJ3 KJ74.AQ7.6532.65',
      trump: 'N',
      declarer: 'S',
      leader: 'W',
      plays: expect.any(Array),
    })
    expect(built.request.plays).toHaveLength(52)
    expect(built.request.plays.slice(0, 4)).toEqual(['S4', 'S8', 'SQ', 'SA'])
    expect(built.players).toEqual({ N: 'kemistry', E: 'missy2727', S: 'aam135', W: 'ARFBridge' })
  })

  it('board 5: an alerted, contested auction still gives 6S by North', () => {
    const built = buildPlayRequest(lin(5))
    expect(built.contract).toBe('6S')
    expect(built.declarer).toBe('N')
    expect(built.request.leader).toBe('E')
    expect(built.request.trump).toBe('S')
  })

  it('returns null for a passed-out board', () => {
    expect(buildPlayRequest('md|3S2,S3,S4,|mb|p|mb|p|mb|p|mb|p|')).toBeNull()
  })
})

describe('solverCard', () => {
  it('writes the ten as T', () => {
    expect(solverCard('H10')).toBe('HT')
    expect(solverCard('SK')).toBe('SK')
  })
})

describe('seatOf', () => {
  it('matches case-insensitively, as BBO does', () => {
    expect(seatOf({ N: 'Kemistry', E: 'a', S: 'b', W: 'c' }, 'kemistry')).toBe('N')
    expect(seatOf({ N: 'x', E: 'a', S: 'b', W: 'c' }, 'kemistry')).toBeNull()
  })
})

describe('summarizeTrace', () => {
  // South declares; North is dummy.
  const trace = [
    { index: 0, seat: 'W', card: 'S4', cost: 0 },
    { index: 1, seat: 'N', card: 'S8', cost: 1 }, // dummy's card: declarer's error
    { index: 2, seat: 'E', card: 'SQ', cost: 2 },
    { index: 3, seat: 'S', card: 'SA', cost: 0 },
    { index: 4, seat: 'S', card: 'DA', cost: 1 },
  ]

  it('numbers each card with its trick', () => {
    const { cards } = summarizeTrace(trace, { declarer: 'S', mySeat: 'N' })
    expect(cards.S4).toEqual({ trick: 1, cost: 0, seat: 'W' })
    expect(cards.DA).toEqual({ trick: 2, cost: 1, seat: 'S' })
  })

  it("charges dummy's cards to declarer, so dummy's own count stays clean", () => {
    const { counts } = summarizeTrace(trace, { declarer: 'S', mySeat: 'N' })
    expect(counts.me).toEqual({ errors: 0, tricks: 0 })
    expect(counts.partner).toEqual({ errors: 2, tricks: 2 })
    expect(counts.opps).toEqual({ errors: 1, tricks: 2 })
  })

  it('counts nothing as "me" for a board the user only watched', () => {
    expect(summarizeTrace(trace, { declarer: 'S', mySeat: null }).counts).toBeNull()
  })
})
