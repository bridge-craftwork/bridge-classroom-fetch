// Per-card double-dummy analysis of one played board: the bridge between a BBO
// LIN and bridge-solver's `Analyzer.dd_play`, and back from its trace to what
// the History panel draws.
//
// Pure functions only. The solver runs in the background (src/background/
// ddSolver.js); the drawing lives in src/ui/bboDdOverlay.js.

import { parseLin, parseLinPlayers, deriveContract } from '../adapters/bbo/parsers/lin.js'

const SEATS = ['N', 'E', 'S', 'W']
const SUITS = ['S', 'H', 'D', 'C']
const RANK_ORDER = 'AKQJT98765432'
const NEXT = { N: 'E', E: 'S', S: 'W', W: 'N' }
const PARTNER = { N: 'S', S: 'N', E: 'W', W: 'E' }

const solverRank = (r) => (r === '10' ? 'T' : r)

/** The card as the solver names it: suit then rank, ten as 'T' ("S4", "HT"). */
export function solverCard(card) {
  return card.length === 3 ? card[0] + 'T' : card
}

/** A LIN → bridge-solver's PlayRequest, plus who sat where.
 *
 *  Returns null when there is nothing to analyse: a passed-out board, or one
 *  with no cards played. Throws (ParseError) on a LIN that does not parse. */
export function buildPlayRequest(lin) {
  const parsed = parseLin(lin)
  const { contract, declarer } = deriveContract(parsed.auction, parsed.dealer)
  if (!contract || !declarer || parsed.play.length === 0) return null

  const strain = /^[1-7](NT|[CDHS])/.exec(contract)[1]
  const hand = (seat) =>
    SUITS.map((s) =>
      parsed.deal[seat][s]
        .map(solverRank)
        .sort((a, b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b))
        .join('')
    ).join('.')

  return {
    request: {
      dealstr: 'N:' + SEATS.map(hand).join(' '),
      trump: strain === 'NT' ? 'N' : strain,
      declarer,
      leader: NEXT[declarer],
      plays: parsed.play.map(solverCard),
    },
    contract,
    declarer,
    players: parseLinPlayers(lin) ?? { N: null, E: null, S: null, W: null },
  }
}

/** Which seat `username` held, matched as BBO does — case-insensitively. */
export function seatOf(players, username) {
  if (!players || !username) return null
  const want = username.toLowerCase()
  return SEATS.find((s) => players[s]?.toLowerCase() === want) ?? null
}

/** The solver's trace → what to draw.
 *
 *  `trace` is dd_play's [{ index, seat, card, cost }]. Returns:
 *    cards:  { [solverCard]: { trick, cost, seat } } — every card played
 *    counts: { me, partner, opps } — each { errors, tricks }, me and partner
 *            with `dummy` too — or null when
 *            `mySeat` is null (a board the user only watched)
 *
 *  Dummy's cards are declarer's decisions, so they count against declarer:
 *  when you are dummy, partner's line is partner's, not yours. */
export function summarizeTrace(trace, { declarer, mySeat }) {
  const dummy = PARTNER[declarer]
  const cards = {}
  const bySeat = { N: zero(), E: zero(), S: zero(), W: zero() }
  for (const t of trace ?? []) {
    cards[t.card] = { trick: Math.floor(t.index / 4) + 1, cost: t.cost, seat: t.seat }
    if (t.cost > 0) {
      const who = t.seat === dummy ? declarer : t.seat
      bySeat[who].errors += 1
      bySeat[who].tricks += t.cost
    }
  }
  if (!mySeat) return { cards, counts: null }
  const opps = [NEXT[mySeat], PARTNER[NEXT[mySeat]]]
  return {
    cards,
    counts: {
      // `dummy` marks the one of you who played no card of their own, so a
      // display can say so rather than credit them with a clean board.
      me: { ...bySeat[mySeat], dummy: mySeat === dummy },
      partner: { ...bySeat[PARTNER[mySeat]], dummy: PARTNER[mySeat] === dummy },
      opps: {
        errors: bySeat[opps[0]].errors + bySeat[opps[1]].errors,
        tricks: bySeat[opps[0]].tricks + bySeat[opps[1]].tricks,
      },
    },
  }
}

function zero() {
  return { errors: 0, tricks: 0 }
}
