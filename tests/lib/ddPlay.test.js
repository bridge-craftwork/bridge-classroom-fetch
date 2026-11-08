import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildPlayRequest,
  summarizeTrace,
  hasRobotPartner,
  seatOf,
  solverCard,
  trickWinners,
  trumpOf,
} from '../../src/lib/ddPlay.js'
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
    expect(cards.S4).toEqual({ trick: 1, lead: true, won: false, cost: 0, signed: 0, seat: 'W' })
    // South declares: a declaring-side error moves declarer's total down.
    expect(cards.DA).toEqual({ trick: 2, lead: true, won: false, cost: 1, signed: -1, seat: 'S' })
    // East defends: the defence handing a trick back moves it up.
    expect(cards.SQ.signed).toBe(2)
    expect(cards.SQ.lead).toBe(false)
  })

  it("charges dummy's cards to declarer, so dummy's own count stays clean", () => {
    const { counts } = summarizeTrace(trace, { declarer: 'S', mySeat: 'N' })
    expect(counts.me).toEqual({ errors: 0, tricks: 0, dummy: true })
    expect(counts.partner).toEqual({ errors: 2, tricks: 2, dummy: false })
    expect(counts.opps).toEqual({ errors: 1, tricks: 2 })
  })

  it("charges a robot partner's declaring to the user, who played it, seen 8 Nov 2026", () => {
    const { counts } = summarizeTrace(trace, { declarer: 'S', mySeat: 'N', robotPartner: true })
    expect(counts.me).toEqual({ errors: 2, tricks: 2, dummy: false })
    expect(counts.partner).toEqual({ errors: 0, tricks: 0, dummy: true })
    expect(counts.opps).toEqual({ errors: 1, tricks: 2 })
  })

  it("leaves a robot partner's defence, and the user's own declaring, as they were", () => {
    const declaring = summarizeTrace(trace, { declarer: 'S', mySeat: 'S', robotPartner: true })
    expect(declaring.counts.me).toEqual({ errors: 2, tricks: 2, dummy: false })
    expect(declaring.counts.partner).toEqual({ errors: 0, tricks: 0, dummy: true })
    const defending = summarizeTrace(trace, { declarer: 'S', mySeat: 'W', robotPartner: true })
    expect(defending.counts.me.errors).toBe(0)
    expect(defending.counts.partner).toEqual({ errors: 1, tricks: 2, dummy: false })
  })

  it('knows a robot by its name', () => {
    expect(hasRobotPartner({ N: '~~M7911muq', S: 'kemistry' }, 'S')).toBe(true)
    expect(hasRobotPartner({ N: '~Mnorth', S: 'kemistry' }, 'S')).toBe(true)
    expect(hasRobotPartner({ N: 'aam135', S: 'kemistry' }, 'S')).toBe(false)
    expect(hasRobotPartner({ N: '~robot' }, null)).toBe(false)
    expect(hasRobotPartner(null, 'S')).toBe(false)
  })

  it('counts nothing as "me" for a board the user only watched', () => {
    expect(summarizeTrace(trace, { declarer: 'S', mySeat: null }).counts).toBeNull()
  })
})

describe('trickWinners', () => {
  const t = (cards) => cards.map((card, index) => ({ index, card, seat: 'N', cost: 0 }))

  it('takes the highest card of the suit led at no-trumps', () => {
    expect(trickWinners(t(['S4', 'S8', 'SQ', 'SA']), 'N')).toEqual(['SA'])
    expect(trickWinners(t(['S4', 'HA', 'S9', 'S2']), 'N')).toEqual(['S9'])
  })

  it('lets a trump beat the suit led, and a higher trump beat it', () => {
    expect(trickWinners(t(['SA', 'H2', 'SK', 'S3']), 'H')).toEqual(['H2'])
    expect(trickWinners(t(['SA', 'H2', 'H5', 'S3']), 'H')).toEqual(['H5'])
  })

  it('names no winner for a trick a claim cut short', () => {
    expect(trickWinners(t(['SA', 'SK', 'SQ', 'SJ', 'HA', 'HK']), 'N')).toEqual(['SA'])
  })

  it('reads the strain from the contract', () => {
    expect(trumpOf('3NT')).toBe('N')
    expect(trumpOf('5HX')).toBe('H')
    expect(trumpOf(null)).toBeNull()
  })
})
