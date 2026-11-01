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

/** The strain of a contract string ("4S", "3NTX") as the solver writes it. */
export function trumpOf(contract) {
  const strain = /^[1-7](NT|[CDHS])/.exec(contract ?? '')?.[1]
  return strain ? (strain === 'NT' ? 'N' : strain) : null
}

/** Who won each complete trick: the highest trump, else the highest card of the
 *  suit led. `trump` is 'S'|'H'|'D'|'C'|'N'. Returns the winning cards, one per
 *  complete trick; a trick cut short by a claim has none. */
export function trickWinners(trace, trump) {
  const winners = []
  for (let i = 0; i + 4 <= (trace?.length ?? 0); i += 4) {
    const trick = trace.slice(i, i + 4)
    const led = trick[0].card[0]
    let best = trick[0]
    for (const t of trick.slice(1)) {
      const suit = t.card[0]
      const bestSuit = best.card[0]
      if (suit === bestSuit) {
        if (RANK_ORDER.indexOf(t.card[1]) < RANK_ORDER.indexOf(best.card[1])) best = t
      } else if (suit === trump && bestSuit !== trump) {
        best = t
      } else if (suit === led && bestSuit !== trump && bestSuit !== led) {
        best = t
      }
    }
    winners.push(best.card)
  }
  return winners
}

/** The solver's trace → what to draw.
 *
 *  `trace` is dd_play's [{ index, seat, card, cost }]. Returns:
 *    cards:  { [solverCard]: { trick, lead, won, cost, signed, seat } } — every
 *            card played. `lead` marks the card that led its trick and `won` the
 *            one that took it. `signed` is the cost as it moved declarer's total,
 *            the bridge-solver site's convention: negative for a trick the
 *            declaring side gave away, positive for one the defence handed back
 *    counts: { me, partner, opps } — each { errors, tricks }, me and partner
 *            with `dummy` too — or null when
 *            `mySeat` is null (a board the user only watched)
 *
 *  Dummy's cards are declarer's decisions, so they count against declarer:
 *  when you are dummy, partner's line is partner's, not yours. */
export function summarizeTrace(trace, { declarer, mySeat, trump = null }) {
  const dummy = PARTNER[declarer]
  const won = new Set(trump ? trickWinners(trace, trump) : [])
  const cards = {}
  const bySeat = { N: zero(), E: zero(), S: zero(), W: zero() }
  for (const t of trace ?? []) {
    const declaring = t.seat === declarer || t.seat === dummy
    cards[t.card] = {
      trick: Math.floor(t.index / 4) + 1,
      lead: t.index % 4 === 0,
      won: won.has(t.card),
      cost: t.cost,
      signed: t.cost > 0 ? (declaring ? -t.cost : t.cost) : 0,
      seat: t.seat,
    }
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
