import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assembleArdBoard,
  createArdBoardBuilder,
  parseArdActions,
  parseArdDeal,
  parseArdEvents,
} from '../../../src/adapters/bbo/parsers/ardPlay.js'
import { parseArdDeals, resultOfLin } from '../../../src/adapters/bbo/parsers/liveXml.js'
import { parseMhHand } from '../../../src/adapters/bbo/parsers/mhXml.js'
import { startDdOverlay } from '../../../src/ui/bboDdOverlay.js'
import { parseLin, deriveContract } from '../../../src/adapters/bbo/parsers/lin.js'

const root = join(import.meta.dirname, '../../..')
const fixture = (name) => readFileSync(join(root, 'fixtures/bbo', name), 'utf8')

// Captured 8 Nov 2026, the token taken out.
const DEAL = fixture('ard-v1-deal.xml')
const LAST_POLL = fixture('ard-v1-poll-end.xml')

describe('the captured messages', () => {
  it('reads the deal: board, dealer, vulnerability and the one hand dealt', () => {
    expect(parseArdDeal(DEAL)).toEqual({
      key: 'HAND/c72577b2-db52-11f1-8901-ac1f6b5a106e/1/1',
      tid: 'c72577b2-db52-11f1-8901-ac1f6b5a106e',
      round: '1',
      number: 1,
      dealer: 'N',
      vul: 'o',
      mySeat: 'S',
      myHand: 'S75HKQJT7DA7CAT83',
      user: 'kemistry',
    })
  })

  it("reads a robot's call with its explanation, a card, and the board's end", () => {
    expect(
      parseArdEvents(
        '<events><sc_call_made call="2H" explain="4+ !H; 11- HCP; 10-12 total points" /></events>'
      )
    ).toEqual([{ call: '2H', explain: '4+ !H; 11- HCP; 10-12 total points', alert: false }])
    expect(parseArdEvents('<events><sc_card_played card="SK" /></events>')).toEqual([
      { card: 'SK' },
    ])
    const end = parseArdEvents(LAST_POLL)
    expect(end[0]).toEqual({ claim: 11 })
    expect(end[1].holds.N).toBe('SKQ3H9842DT6532C4')
    expect(end[2]).toEqual({ result: '4HS+1' })
  })

  it("reads the user's calls and cards from the poll's actions", () => {
    expect(
      parseArdActions('[{"t":"b", "b":"2C", "e":"Strong two club -- 19+ HCP", "a":"n"}]')
    ).toEqual([{ call: '2C', explain: 'Strong two club -- 19+ HCP', alert: false }])
    expect(parseArdActions('[{"t":"p", "c":"SA"},{"t":"p", "c":"H9"}]')).toEqual([
      { card: 'SA' },
      { card: 'H9' },
    ])
    expect(parseArdActions('[]')).toEqual([])
  })
})

// Plays a finished board back as BBO's polls would carry it: the user's calls in
// a poll's actions; the user's cards there too, and partner's when their side
// declares (BBO has the user play both hands); every robot move in a poll's
// answer; and the hands and result in the last.
const ORDER = ['N', 'E', 'S', 'W']
const PARTNER = { N: 'S', S: 'N', E: 'W', W: 'E' }
const lin10 = (r) => (r === '10' ? 'T' : r)

function replay(board, { userSeat = 'S', user = 'kemistry', tid = 'tid-1', claim = null } = {}) {
  const parsed = parseLin(board.lin)
  const hand = (s) =>
    ['S', 'H', 'D', 'C'].map((suit) => suit + parsed.deal[s][suit].map(lin10).join('')).join('')
  const holder = {}
  for (const s of ORDER) {
    for (const suit of ['S', 'H', 'D', 'C']) {
      for (const r of parsed.deal[s][suit]) holder[suit + lin10(r)] = s
    }
  }
  const { declarer } = deriveContract(parsed.auction, parsed.dealer)
  const ourSide = declarer === userSeat || declarer === PARTNER[userSeat]
  const playsFor = (seat) => seat === userSeat || (ourSide && seat === PARTNER[userSeat])

  const dealid = `HAND/${tid}/1/${board.number}`
  const shown = { N: 'SHDC', E: 'SHDC', S: 'SHDC', W: 'SHDC', [userSeat]: hand(userSeat) }
  const deal =
    `<deal err="0" dealid="${dealid}"><sc_deal south="${shown.S}" west="${shown.W}" ` +
    `north="${shown.N}" east="${shown.E}" dealer="${parsed.dealer}" board="${board.number}" ` +
    `scoring="MP" vul="o" dealid="${dealid}/${user}"/></deal>`

  const polls = []
  const calls = [...board.lin.matchAll(/mb\|([^|]*)\|(?:an\|([^|]*)\|)?/g)]
  calls.forEach(([, call, explain = ''], i) => {
    const seat = ORDER[(ORDER.indexOf(parsed.dealer) + i) % 4]
    const c = call.toUpperCase()
    if (seat === userSeat) {
      polls.push({ actions: JSON.stringify([{ t: 'b', b: c, e: explain, a: 'n' }]) })
    } else {
      const ex = explain ? ` explain="${explain.replace(/"/g, '&quot;')}"` : ''
      polls.push({ text: `<events><sc_call_made call="${c}"${ex} /></events>` })
    }
  })
  for (const [, card] of board.lin.matchAll(/pc\|([^|]*)\|/g)) {
    if (playsFor(holder[card])) polls.push({ actions: JSON.stringify([{ t: 'p', c: card }]) })
    else polls.push({ text: `<events><sc_card_played card="${card}" /></events>` })
  }
  const holds =
    `<sc_player_holds north="${hand('N')}" south="${hand('S')}" east="${hand('E')}" ` +
    `west="${hand('W')}" />`
  const claimed = claim !== null ? `<sc_claim_accept tricks="${claim}" />` : ''
  polls.push({
    text: `<events>${claimed}${holds}<sc_deal_complete result="${board.result}" /></events>`,
  })
  return { dealid, deal, polls }
}

const claimOf = (board) => {
  const m = /mc\|(\d+)\|/.exec(board.lin)
  return m ? Number(m[1]) : null
}

function run(builder, { dealid, deal, polls }) {
  builder.deal(deal)
  let out = null
  for (const p of polls) out = builder.poll(dealid, p.actions ?? '[]', p.text ?? '') ?? out
  return out
}

describe('building a board from the polls', () => {
  const daylong = parseArdDeals(fixture('ard-deals-daylong.xml')).boards

  it('gives back what ard.php gives for the same boards', () => {
    for (const board of daylong) {
      const built = run(
        createArdBoardBuilder({ onDrop: (e) => console.error(board.number, e.message) }),
        replay(board, { claim: claimOf(board) })
      )
      expect(built, `board ${board.number}`).not.toBeNull()
      const a = parseLin(built.lin)
      const b = parseLin(board.lin)
      expect(a.deal).toEqual(b.deal)
      expect(a.dealer).toBe(b.dealer)
      expect(a.auction).toEqual(b.auction)
      expect(a.play).toEqual(b.play)
      expect(built.result).toBe(board.result)
      expect(built.hk).toBe(`ard:tid-1:1:${board.number}`)
      expect(built.players.S).toBe('kemistry')
      expect(built.players.N).toBe('~robot')
    }
  })

  it('keeps the explanations, the user’s and the robots’', () => {
    const board = daylong.find((b) => /an\|/.test(b.lin))
    const built = run(createArdBoardBuilder(), replay(board, { claim: claimOf(board) }))
    expect(built.lin.match(/an\|/g).length).toBe(board.lin.match(/an\|/g).length)
  })

  it('waits for the hands when the result comes first, in another poll', () => {
    const board = daylong.find((b) => !/mc\|/.test(b.lin) && b.lin.includes('pc|')) ?? daylong[0]
    const r = replay(board, { claim: claimOf(board) })
    const last = r.polls.at(-1).text
    const holds = /<sc_player_holds[^>]*\/>/.exec(last)[0]
    const split = [{ text: last.replace(holds, '') }, { text: `<events>${holds}</events>` }]
    const dropped = []
    const built = run(createArdBoardBuilder({ onDrop: (e) => dropped.push(e.message) }), {
      ...r,
      polls: [...r.polls.slice(0, -1), ...split],
    })
    expect(dropped).toEqual([])
    expect(built?.hk).toBe(`ard:tid-1:1:${board.number}`)
  })

  it("ignores dummy's hand shown at the lead, and waits for all four", () => {
    // Board 5 of a Robot Individual, 8 Nov 2026: dummy's hand came alone after
    // the lead, the result in one poll and the four hands in the next.
    const board = daylong.find((b) => (b.lin.match(/pc\|/g)?.length ?? 0) >= 4)
    const r = replay(board, { claim: claimOf(board) })
    const parsed = parseLin(board.lin)
    const { declarer } = deriveContract(parsed.auction, parsed.dealer)
    const dummy = PARTNER[declarer]
    const name = { N: 'north', E: 'east', S: 'south', W: 'west' }[dummy]
    const dummyHand = /<sc_player_holds[^>]*>/
      .exec(r.polls.at(-1).text)[0]
      .match(new RegExp(`${name}="([^"]*)"`))[1]
    const firstCard = r.polls.findIndex((p) => /card|"p"/.test((p.text ?? '') + (p.actions ?? '')))
    const last = r.polls.at(-1).text
    const holds = /<sc_player_holds[^>]*\/>/.exec(last)[0]
    const polls = [
      ...r.polls.slice(0, firstCard + 1),
      { text: `<events><sc_player_holds ${name}="${dummyHand}" /></events>` },
      ...r.polls.slice(firstCard + 1, -1),
      { text: last.replace(holds, '') },
      { text: `<events>${holds}</events>` },
    ]
    const dropped = []
    const built = run(createArdBoardBuilder({ onDrop: (e) => dropped.push(e.message) }), {
      ...r,
      polls,
    })
    expect(dropped).toEqual([])
    expect(parseLin(built.lin).play).toEqual(parsed.play)
  })

  it("takes the robots' calls made before the user's turn from the deal's answer", () => {
    // Dealer two seats before the user: both robots have called by the time the
    // deal is fetched, and their calls come with it (8 Nov 2026).
    const board = daylong.find((b) => {
      const p = parseLin(b.lin)
      return p.dealer === 'N' && p.auction.length > 4
    })
    expect(board).toBeTruthy()
    const r = replay(board, { claim: claimOf(board) })
    const early = r.polls.slice(0, 2).map((p) => /<sc_call_made[^>]*\/>/.exec(p.text)[0])
    const deal = r.deal.replace('</deal>', `${early.join('')}</deal>`)
    const built = run(createArdBoardBuilder({ onDrop: (e) => console.error(e.message) }), {
      ...r,
      deal,
      polls: r.polls.slice(2),
    })
    expect(parseLin(built.lin).auction).toEqual(parseLin(board.lin).auction)
  })

  it('keeps the moves when BBO asks for the same deal again', () => {
    const board = daylong.find((b) => b.lin.includes('pc|'))
    const r = replay(board, { claim: claimOf(board) })
    const polls = [...r.polls.slice(0, 3), { redeal: true }, ...r.polls.slice(3)]
    const builder = createArdBoardBuilder()
    builder.deal(r.deal)
    let out = null
    for (const p of polls) {
      if (p.redeal) builder.deal(r.deal)
      else out = builder.poll(r.dealid, p.actions ?? '[]', p.text ?? '') ?? out
    }
    expect(parseLin(out.lin).auction).toEqual(parseLin(board.lin).auction)
  })

  it('works out the hands of a board played to the last card, which come with no holds', () => {
    // Every daylong board in the fixture ended on a claim; this one is played out.
    const { lin } = parseMhHand(fixture('mh-hand-33873-board1.xml'))
    const board = { number: 1, lin, result: resultOfLin(lin) }
    const r = replay(board)
    const polls = [...r.polls]
    polls[polls.length - 1] = {
      text: polls.at(-1).text.replace(/<sc_player_holds[^>]*\/>/, ''),
    }
    const dropped = []
    const built = run(createArdBoardBuilder({ onDrop: (e) => dropped.push(e.message) }), {
      ...r,
      polls,
    })
    expect(dropped).toEqual([])
    const a = parseLin(built.lin)
    const b = parseLin(board.lin)
    const sorted = (deal) =>
      Object.fromEntries(
        Object.entries(deal).map(([seat, hand]) => [
          seat,
          Object.fromEntries(
            Object.entries(hand).map(([suit, ranks]) => [suit, [...ranks].sort()])
          ),
        ])
      )
    expect(sorted(a.deal)).toEqual(sorted(b.deal))
    expect(a.play).toEqual(b.play)
    expect(built.result).toBe(board.result)
  })

  it('drops a board joined halfway, rather than guess', () => {
    const board = daylong.find((b) => b.lin.includes('pc|'))
    const r = replay(board, { claim: claimOf(board) })
    const dropped = []
    const out = run(createArdBoardBuilder({ onDrop: (e) => dropped.push(e.message) }), {
      ...r,
      polls: r.polls.slice(3),
    })
    expect(out).toBeNull()
    expect(dropped.length).toBe(1)
  })

  it('drops a board whose cards came out of order', () => {
    const board = daylong.find((b) => (b.lin.match(/pc\|/g)?.length ?? 0) >= 8)
    const r = replay(board, { claim: claimOf(board) })
    const firstCard = r.polls.findIndex((p) => /card|"p"/.test((p.text ?? '') + (p.actions ?? '')))
    const polls = [...r.polls]
    ;[polls[firstCard], polls[firstCard + 1]] = [polls[firstCard + 1], polls[firstCard]]
    const dropped = []
    expect(
      run(createArdBoardBuilder({ onDrop: (e) => dropped.push(e.message) }), { ...r, polls })
    ).toBeNull()
    expect(dropped[0]).toMatch(/not .*'s to play|revokes/)
  })

  it('says so when a board is given up unfinished', () => {
    const [a, b, c] = daylong
    const dropped = []
    const builder = createArdBoardBuilder({ onDrop: (e) => dropped.push(e.message) })
    const ra = replay(a, { claim: claimOf(a), tid: 't' })
    builder.deal(ra.deal)
    builder.poll(ra.dealid, ra.polls[0].actions ?? '[]', ra.polls[0].text ?? '')
    builder.deal(replay(b, { tid: 't' }).deal)
    expect(dropped).toEqual([])
    builder.deal(replay(c, { tid: 't' }).deal)
    expect(dropped).toEqual([
      `ard board ${a.number} never finished: 1 calls, 0 cards, no result, no full hands`,
    ])
  })

  it('ignores polls for a board it never saw dealt', () => {
    expect(createArdBoardBuilder().poll('HAND/x/1/9', '[]', LAST_POLL)).toBeNull()
  })

  it('refuses an auction that does not give BBO’s result', () => {
    const deal = parseArdDeal(DEAL)
    const moves = [...parseArdEvents(LAST_POLL)]
    expect(() =>
      assembleArdBoard(deal, [
        { call: '1N', explain: '' },
        { call: 'P' },
        { call: 'P' },
        { call: 'P' },
        ...moves,
      ])
    ).toThrow(/BBO says/)
  })
})

describe("the overlay, given the hook's copies", () => {
  it('asks for the board to be analysed as soon as it ends', async () => {
    const board = parseArdDeals(fixture('ard-deals-daylong.xml')).boards[0]
    const r = replay(board, { claim: claimOf(board) })
    const sent = []
    startDdOverlay({
      doc: document,
      win: window,
      sendMessage: async (msg) => {
        sent.push(msg)
        return msg.type === 'dd-trace'
          ? { type: 'dd-trace', entry: { contract: null, trace: [] } }
          : {}
      },
    })
    const post = (data) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'bridge-classroom-bbo', ...data },
          source: window,
        })
      )
    post({ kind: 'ard-deal', body: r.deal, requestBody: null })
    for (const p of r.polls) {
      post({
        kind: 'ard-poll',
        body: p.text ?? '<events/>',
        requestBody: JSON.stringify({ dealid: r.dealid, actions: p.actions ?? '[]' }),
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
    const traces = sent.filter((m) => m.type === 'dd-trace')
    expect(traces.map((m) => m.resultkey)).toEqual([`ard:tid-1:1:${board.number}`])
    expect(parseLin(traces[0].lin).play).toEqual(parseLin(board.lin).play)
  })
})
