import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMhList, parseMhHand, parseTfind } from '../../../src/adapters/bbo/parsers/mhXml.js'
import { parseLinPlayers } from '../../../src/adapters/bbo/parsers/lin.js'

const fixture = (name) =>
  readFileSync(join(import.meta.dirname, '../../../fixtures/bbo', name), 'utf8')

// Real responses from BBO's History panel: #33873 ACBL Sun 11AM ET (MP)
// Speedball, 1 Nov 2026, as kemistry. Both endpoints are public.
describe('parseMhList', () => {
  const list = parseMhList(fixture('mh-list-33873-kemistry.xml'))

  it('reads the event and whose results they are', () => {
    expect(list.tkey).toBe('33873-1793548800')
    expect(list.username).toBe('kemistry')
  })

  it('reads every board, in order, with the key that fetches its hand', () => {
    expect(list.boards.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(list.boards[0]).toEqual({
      number: 1,
      resultkey: 'h/4748677413/33873-1793548800-50407802/2026-11-01 16:04:55',
      result: '3NS+2',
      scoring: 'mp',
      players: { N: 'kemistry', E: 'missy2727', S: 'aam135', W: 'ARFBridge' },
    })
  })

  it('leaves out a board with no result rather than inventing one', () => {
    const xml =
      '<sc_boards tkey="1-2" username="u"><sc_board_group><sc_board number="1" tbn="1"/></sc_board_group></sc_boards>'
    expect(parseMhList(xml).boards).toEqual([])
  })

  it('fails loudly on something that is not a board list', () => {
    expect(() => parseMhList('<status err="1"/>')).toThrow('expected <sc_boards>')
    expect(() => parseMhList('<<not xml')).toThrow('not well-formed')
    expect(() => parseMhList('')).toThrow('non-empty')
  })
})

describe('parseMhHand', () => {
  const { hk, lin } = parseMhHand(fixture('mh-hand-33873-board1.xml'))

  it('reads the key and the LIN, play included', () => {
    expect(hk).toBe('h/4748677413/33873-1793548800-50407802/2026-11-01 16:04:55')
    expect(lin).toMatch(/^pn\|aam135,ARFBridge,kemistry,missy2727\|/)
    expect(lin.match(/\|pc\|/g)).toHaveLength(52)
  })

  it("reports BBO's own error rather than an empty hand", () => {
    const err = '<?xml version="1.0"?><status err="1" errmsg="Missing: hand id" request_id=""/>'
    expect(() => parseMhHand(err)).toThrow('Missing: hand id')
  })
})

// Seat order has been wrong twice in this project (docs/seat-order-contract.md).
// mh_list names each seat by attribute; the LIN's pn| is positional (S,W,N,E).
// Two independent sources that must agree.
describe('seat order: mh_list attributes agree with the LIN pn|', () => {
  it('board 1 and board 5', () => {
    const list = parseMhList(fixture('mh-list-33873-kemistry.xml'))
    for (const n of [1, 5]) {
      const { lin } = parseMhHand(fixture(`mh-hand-33873-board${n}.xml`))
      expect(parseLinPlayers(lin)).toEqual(list.boards[n - 1].players)
    }
  })
})

describe('parseTfind', () => {
  const events = parseTfind(fixture('tfind-kemistry.xml'))

  it('reads each event, with the key and fields a board list asks for', () => {
    const first = events.find((e) => e.number === '33879')
    expect(first).toMatchObject({
      tkey: '33879-1793552400',
      title: '#33879 ACBL Sun Noon ET Speedball (GIB)',
      teamname: 'kemistry+aam135',
      format: 'pairs',
      username: 'kemistry',
      started: 1793552400000,
      award: 0,
    })
  })

  it('reads a daylong, whose key and number look different', () => {
    const daylong = events.find((e) => e.number === '51908583')
    expect(daylong.tkey).toMatch(/^ARDARD:/)
    expect(daylong.format).toBe('indy')
  })

  it('reads a prize as a number', () => {
    const xml =
      '<tourneys><tourney tkey="1-2" tourney_number="1" award="1.50" prettyaward="1.50 BB$"/></tourneys>'
    expect(parseTfind(xml)[0].award).toBe(1.5)
  })

  it('leaves out a row with no key', () => {
    expect(parseTfind('<tourneys><tourney title="x"/></tourneys>')).toEqual([])
  })

  it('says so when the response is something else', () => {
    expect(() => parseTfind('<status err="1"/>')).toThrow(/tfind: expected <tourneys>/)
  })
})
