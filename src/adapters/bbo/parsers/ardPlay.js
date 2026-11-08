// A daylong's boards as they are played, built from BBO's robot-game requests to
// bboardapi.bridgebase.com, so each board can be analysed as it ends rather than
// after the next reload (when ard.php's <deals> brings them all; see liveXml.js).
//
// Captured from a live daylong, 8 Nov 2026:
//
//   ard_v1/deal, response — the board, and the user's hand only:
//     <deal … dealid="HAND/<tid>/1/1"><sc_deal south="S75HKQJT7DA7CAT83" west="SHDC"
//        north="SHDC" east="SHDC" dealer="N" board="1" vul="o" dealid="…/1/1/kemistry"/></deal>
//
//   ard_v1/poll, request — the user's own moves, form fields dealid and actions:
//     dealid=HAND/<tid>/1/3
//     actions=[{"t":"b","b":"2C","e":"Strong two club -- …","a":"n"}]   a call
//     actions=[{"t":"p","c":"SA"},{"t":"p","c":"H9"}]                    two cards
//
//   ard_v1/poll, response — the robots' moves, then at the end the hands and result:
//     <events …><sc_call_made call="2H" explain="4+ !H; 11- HCP; …"/></events>
//     <events …><sc_card_played card="SK"/></events>
//     <events …><sc_claim_accept tricks="11"/>
//       <sc_player_holds north="…" south="…" east="…" west="…"/>
//       <sc_deal_complete result="4HS+1"/></events>
//
// The user's moves go out in a request and the robots' come back in its answer,
// so a board is the two interleaved in the order they pass. Nothing names the
// seat of a card; the hands at the end do. A board is only handed on when it
// checks out against them: the user's hand as dealt, the contract and declarer
// in BBO's result, and every card played by the hand that held it, in turn,
// following suit. Anything else, a board joined halfway included, is dropped,
// and the next reload brings it from ard.php.

import { ParseError } from '../../../lib/parseError.js'
import { deriveContract } from './lin.js'

const SEATS = ['N', 'E', 'S', 'W']
const LIN_SEATS = ['S', 'W', 'N', 'E']
const NEXT = { N: 'E', E: 'S', S: 'W', W: 'N' }
const SIDE = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' }
const LIN_DEALER = { S: '1', W: '2', N: '3', E: '4' }
const RANKS = 'AKQJT98765432'
const HAND_RE = /^S([2-9TJQKA]*)H([2-9TJQKA]*)D([2-9TJQKA]*)C([2-9TJQKA]*)$/
const CARD_RE = /^[SHDC][2-9TJQKA]$/
const DEALID_RE = /^HAND\/([\w-]+)\/(\d+)\/(\d+)(?:\/|$)/

// LIN's separator can't appear in a value; an explanation is the only free text.
const clean = (text) =>
  String(text ?? '')
    .replace(/\|/g, '/')
    .trim()

function xml(text, what) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ParseError(`ard ${what}: expected a non-empty XML string`)
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new ParseError(`ard ${what}: not well-formed XML`)
  }
  return doc
}

/** "HAND/<tid>/<round>/<board>[/user]" → { tid, round, number }, or null. */
export function parseDealId(dealid) {
  const m = DEALID_RE.exec(dealid ?? '')
  return m
    ? { tid: m[1], round: m[2], number: Number(m[3]), key: `HAND/${m[1]}/${m[2]}/${m[3]}` }
    : null
}

/** ard_v1/deal's answer → { key, tid, round, number, dealer, vul, mySeat, myHand,
 *  user }. The user's seat is the one hand dealt; the user's name ends the
 *  sc_deal's own dealid. */
export function parseArdDeal(text) {
  const doc = xml(text, 'deal')
  const deal = doc.getElementsByTagName('sc_deal')[0]
  if (!deal) throw new ParseError('ard deal: no <sc_deal>')
  const id = parseDealId(deal.getAttribute('dealid') ?? doc.documentElement.getAttribute('dealid'))
  if (!id) throw new ParseError('ard deal: no dealid')
  const dealer = deal.getAttribute('dealer')?.toUpperCase()
  if (!LIN_DEALER[dealer]) throw new ParseError('ard deal: unknown dealer')
  const held = SEATS.filter((s) => (deal.getAttribute(seatName(s)) ?? '').length > 4)
  if (held.length !== 1) throw new ParseError('ard deal: expected exactly one hand dealt')
  const mySeat = held[0]
  const myHand = deal.getAttribute(seatName(mySeat))
  if (!HAND_RE.test(myHand)) throw new ParseError('ard deal: hand not in S…H…D…C… form')
  const user = /^HAND\/[^/]+\/\d+\/\d+\/(.+)$/.exec(deal.getAttribute('dealid') ?? '')?.[1] ?? null
  return {
    ...id,
    dealer,
    vul: (deal.getAttribute('vul') ?? 'o').toLowerCase(),
    mySeat,
    myHand,
    user,
  }
}

function seatName(seat) {
  return { N: 'north', E: 'east', S: 'south', W: 'west' }[seat]
}

/** A poll's answer → the robots' moves and the board's end, in order:
 *  { call, explain, alert } | { card } | { claim } | { holds } | { result }. */
export function parseArdEvents(text) {
  const doc = xml(text, 'poll')
  const out = []
  for (const el of doc.documentElement.children) {
    const tag = el.tagName
    if (tag === 'sc_call_made') {
      const call = el.getAttribute('call')
      if (call) {
        out.push({
          call,
          explain: el.getAttribute('explain') ?? '',
          alert: /^y/i.test(el.getAttribute('alert') ?? ''),
        })
      }
    } else if (tag === 'sc_card_played') {
      out.push({ card: el.getAttribute('card') })
    } else if (tag === 'sc_claim_accept') {
      out.push({ claim: Number.parseInt(el.getAttribute('tricks'), 10) })
    } else if (tag === 'sc_player_holds') {
      const holds = {}
      for (const s of SEATS) holds[s] = el.getAttribute(seatName(s)) ?? ''
      out.push({ holds })
    } else if (tag === 'sc_deal_complete') {
      out.push({ result: el.getAttribute('result') ?? '' })
    }
  }
  return out
}

/** A poll's actions field → the user's moves, as parseArdEvents writes them.
 *  Anything not a call or a card (a claim, say) is left out. */
export function parseArdActions(json) {
  let list
  try {
    list = JSON.parse(json || '[]')
  } catch {
    throw new ParseError('ard actions: not JSON')
  }
  if (!Array.isArray(list)) throw new ParseError('ard actions: not a list')
  const out = []
  for (const a of list) {
    if (a?.t === 'b' && typeof a.b === 'string') {
      out.push({
        call: a.b,
        explain: typeof a.e === 'string' ? a.e : '',
        alert: /^y/i.test(a.a ?? ''),
      })
    } else if (a?.t === 'p' && typeof a.c === 'string') {
      out.push({ card: a.c })
    }
  }
  return out
}

// A call as LIN writes it: p, d, r, or a bid with N for notrump.
function linCall(call) {
  const c = call.trim().toUpperCase()
  if (c === 'P' || c === 'PASS') return 'p'
  if (c === 'X' || c === 'D' || c === 'DBL') return 'd'
  if (c === 'XX' || c === 'R' || c === 'RDBL') return 'r'
  const m = /^([1-7])(NT|N|[CDHS])$/.exec(c)
  return m ? `${m[1]}${m[2] === 'NT' ? 'N' : m[2]}` : null
}

const AUCTION_CALL = { p: 'PASS', d: 'X', r: 'XX' }

function sortHand(hand) {
  return hand.replace(
    /([SHDC])([^SHDC]*)/g,
    (_, suit, ranks) =>
      suit + [...ranks].sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b)).join('')
  )
}

// "4HS+1" → { level, strain, declarer, doubled, tricks }; "P" → { passed: true }.
function parseResult(result) {
  if (/^p(ass)?$/i.test(result)) return { passed: true }
  const m = /^([1-7])(N|NT|[CDHS])([NESW])(x{0,2})(=|[+-]\d+)$/i.exec(result ?? '')
  if (!m) return null
  const level = Number(m[1])
  const over = m[5] === '=' ? 0 : Number(m[5])
  return {
    level,
    strain: m[2].toUpperCase().startsWith('N') ? 'NT' : m[2].toUpperCase(),
    declarer: m[3].toUpperCase(),
    doubled: m[4].toUpperCase(),
    tricks: level + 6 + over,
  }
}

// All four hands, thirteen cards each. BBO also sends sc_player_holds with
// dummy's hand alone once the lead is made (seen 8 Nov 2026): that is not the end.
export function isFullDeal(holds) {
  return ['N', 'E', 'S', 'W'].every((s) => {
    const m = HAND_RE.exec(holds?.[s] ?? '')
    return !!m && m.slice(1).join('').length === 13
  })
}

/** One finished board → { number, hk, lin, result, players }, the shape
 *  parseArdDeals gives, or throws (ParseError) saying what did not check out. */
export function assembleArdBoard(deal, moves) {
  const end = {}
  const calls = []
  const cards = []
  for (const m of moves) {
    if (m.holds) {
      if (isFullDeal(m.holds)) end.holds = m.holds
    } else if (m.result !== undefined) end.result = m.result
    else if (m.claim !== undefined) end.claim = m.claim
    else if (m.call !== undefined) {
      const call = linCall(m.call)
      if (!call) throw new ParseError(`ard board: unknown call ${m.call}`)
      calls.push({ call, explain: clean(m.explain), alert: m.alert })
    } else if (m.card !== undefined) {
      if (!CARD_RE.test(m.card ?? '')) throw new ParseError(`ard board: unknown card ${m.card}`)
      cards.push(m.card)
    }
  }
  if (!end.holds) throw new ParseError('ard board: no hands shown at the end')
  if (end.result === undefined) throw new ParseError('ard board: no result')

  const holder = {}
  for (const s of SEATS) {
    const m = HAND_RE.exec(end.holds[s] ?? '')
    if (!m) throw new ParseError(`ard board: ${s}'s hand is not in S…H…D…C… form`)
    ;['S', 'H', 'D', 'C'].forEach((suit, i) => {
      for (const r of m[i + 1]) {
        if (holder[suit + r]) throw new ParseError(`ard board: ${suit + r} dealt twice`)
        holder[suit + r] = s
      }
    })
  }
  if (Object.keys(holder).length !== 52) throw new ParseError('ard board: the deal is not 52 cards')
  if (sortHand(end.holds[deal.mySeat]) !== sortHand(deal.myHand)) {
    throw new ParseError("ard board: the user's hand is not the one dealt")
  }

  // The auction must give BBO's own contract and declarer.
  const auction = calls.map((c) => AUCTION_CALL[c.call] ?? c.call.replace(/N$/, 'NT'))
  const { contract, declarer } = deriveContract(auction, deal.dealer)
  const result = parseResult(end.result)
  if (!result) throw new ParseError(`ard board: unknown result ${end.result}`)
  if (result.passed) {
    if (contract || calls.length !== 4)
      throw new ParseError('ard board: passed out, but not by the auction')
    if (cards.length) throw new ParseError('ard board: passed out, but cards were played')
  } else {
    const expected = `${result.level}${result.strain}${result.doubled}`
    if (contract !== expected || declarer !== result.declarer) {
      throw new ParseError(
        `ard board: the auction gives ${contract} by ${declarer}, BBO says ${end.result}` +
          ` (dealer ${deal.dealer}, calls ${calls.map((c) => c.call).join(' ')})`
      )
    }
  }

  // Every card from the hand that held it, in turn, following suit.
  if (!result.passed) {
    const trump = result.strain === 'NT' ? null : result.strain
    const left = { ...holder }
    let leader = NEXT[declarer]
    let won = 0
    for (let i = 0; i < cards.length; i += 4) {
      const trick = cards.slice(i, i + 4)
      let seat = leader
      for (const [j, card] of trick.entries()) {
        if (left[card] !== seat) throw new ParseError(`ard board: ${card} is not ${seat}'s to play`)
        const led = trick[0][0]
        if (j > 0 && card[0] !== led) {
          const couldFollow = Object.entries(left).some(([c, s]) => s === seat && c[0] === led)
          if (couldFollow) throw new ParseError(`ard board: ${card} revokes`)
        }
        delete left[card]
        seat = NEXT[seat]
      }
      if (trick.length < 4) break
      const best = trick.reduce((a, b) => {
        if (b[0] === a[0]) return RANKS.indexOf(b[1]) < RANKS.indexOf(a[1]) ? b : a
        return b[0] === trump ? b : a
      })
      leader = holder[best]
      if (SIDE[leader] === SIDE[declarer]) won++
    }
    if (cards.length === 52 && end.claim === undefined && won !== result.tricks) {
      throw new ParseError(`ard board: the play makes ${won} tricks, BBO says ${end.result}`)
    }
    if (cards.length < 52 && end.claim === undefined) {
      throw new ParseError('ard board: play stops short with no claim')
    }
  }

  const players = {}
  for (const s of SEATS) players[s] = s === deal.mySeat ? deal.user : '~robot'
  const parts = [
    `pn|${LIN_SEATS.map((s) => players[s] ?? '').join(',')}|`,
    `md|${LIN_DEALER[deal.dealer]}${LIN_SEATS.map((s) => sortHand(end.holds[s])).join(',')}|`,
    `sv|${deal.vul}|`,
    `ah|Board ${deal.number}|`,
  ]
  for (const c of calls) {
    parts.push(`mb|${c.call}${c.alert ? '!' : ''}|`)
    if (c.explain) parts.push(`an|${c.explain}|`)
  }
  for (const card of cards) parts.push(`pc|${card}|`)
  if (!result.passed && cards.length < 52) parts.push(`mc|${result.tricks}|`)
  return {
    number: deal.number,
    hk: `ard:${deal.tid}:${deal.round}:${deal.number}`,
    lin: parts.join(''),
    result: end.result,
    players: { N: players.N, E: players.E, S: players.S, W: players.W },
    tid: deal.tid,
  }
}

/** Collects each board's deal and moves as they pass. `deal(text)` takes
 *  ard_v1/deal's answer; `poll(dealid, actions, text)` a poll's request fields
 *  and answer, and returns the finished board when this poll ended one, else
 *  null. A board that does not check out is dropped, with `onDrop(err)`. */
export function createArdBoardBuilder({ onDrop = () => {} } = {}) {
  const boards = new Map() // HAND/<tid>/<round>/<board> → { deal, moves }

  return {
    deal(text) {
      const deal = parseArdDeal(text)
      // Robots who call before the user has a turn have done so by the time the
      // deal is asked for, and their calls come in its answer beside <sc_deal>
      // (seen 8 Nov 2026: a board's dealer's pass, then two calls, missing).
      // Asked again for a board under way, the moves so far are kept as they are.
      if (!boards.has(deal.key)) boards.set(deal.key, { deal, moves: parseArdEvents(text) })
      // One board at a time, so a board two deals back is not going to finish.
      // Say so, and what it had, rather than let it go quietly.
      for (const [k, b] of boards) {
        if (k === deal.key || boards.size <= 2) continue
        boards.delete(k)
        const calls = b.moves.filter((m) => m.call !== undefined).length
        const cards = b.moves.filter((m) => m.card !== undefined).length
        const result = b.moves.some((m) => m.result !== undefined)
        const hands = b.moves.some((m) => m.holds && isFullDeal(m.holds))
        onDrop(
          new ParseError(
            `ard board ${b.deal.number} never finished: ${calls} calls, ${cards} cards, ` +
              `${result ? 'a result' : 'no result'}, ${hands ? 'all four hands' : 'no full hands'}`
          )
        )
      }
      return deal
    },
    poll(dealid, actions, text) {
      const id = parseDealId(dealid)
      const board = id && boards.get(id.key)
      if (!board) return null
      board.moves.push(...parseArdActions(actions))
      if (text) board.moves.push(...parseArdEvents(text))
      // The result and the four hands can come in separate polls (a board played
      // to the last card, 8 Nov 2026), so the board waits for both.
      const ended = board.moves.some((m) => m.result !== undefined)
      const shown = board.moves.some((m) => m.holds && isFullDeal(m.holds))
      if (!ended || !shown) return null
      boards.delete(id.key)
      try {
        return assembleArdBoard(board.deal, board.moves)
      } catch (err) {
        onDrop(err)
        return null
      }
    },
  }
}
