// Parse a board from BBO's game connection: the <sc_board_details> the v3 client
// asks for when the player opens a board in History's My Table, the event being
// played. Its deal, auction and play are what mh_hand.php gives for a finished
// event, in another shape:
//
//   <sc_board_details request_id="d~t~52031~1~16~0" resultonly="n" >
//     <sc_deal south="S278KAHJQAD289C4J" west=… north=… east=… vul="e"
//              dealer="w" board="16" labelsouth="…" labelwest=… />
//     <sc_call_made call="1D" alert="N" explain=""/> …
//     <sc_card_played card="CA" /> …
//   </sc_board_details >
//
// Captured from a live event, 6 Nov 2026. The page hook copies only this message
// and the user attribute of the login message; see public-dd/bbo-page-hook.js.
//
// It is turned into LIN, so everything downstream (solver, drawing, DD Details)
// reads it exactly as it reads a board from History.

import { ParseError } from '../../../lib/parseError.js'
import { parseLin, deriveContract } from './lin.js'
import { solverCard, trickWinners, trumpOf } from '../../../lib/ddPlay.js'

const LIN_DEALER = { s: '1', w: '2', n: '3', e: '4' }
const LIN_VUL = { o: 'o', n: 'n', e: 'e', b: 'b' }
const RANKS = 'AKQJT98765432'

// "S278KAHJQAD289C4J" → "SAK872HAQJD982CJ4": BBO sends ranks in no order.
function sortHand(hand) {
  return hand.replace(
    /([SHDC])([^SHDC]*)/g,
    (_, suit, ranks) =>
      suit + [...ranks].sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b)).join('')
  )
}

// LIN's separator can't appear in a value; an explanation is the only free text.
const clean = (text) =>
  String(text ?? '')
    .replace(/\|/g, '/')
    .trim()

/** sc_board_details → { hk, lin, number }. `hk` stands in for History's hand key:
 *  "live:" and the request's own id, which names event, board and table. */
export function parseBoardDetails(xml) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new ParseError('board details: expected a non-empty XML string')
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new ParseError('board details: not well-formed XML')
  }
  const root = doc.documentElement
  if (root?.tagName !== 'sc_board_details') {
    throw new ParseError(
      `board details: expected <sc_board_details>, got <${root?.tagName ?? 'nothing'}>`
    )
  }
  const requestId = root.getAttribute('request_id')
  const deal = root.getElementsByTagName('sc_deal')[0]
  if (!requestId || !deal) throw new ParseError('board details: no request id or no deal')

  const hands = ['south', 'west', 'north', 'east'].map((seat) => deal.getAttribute(seat) ?? '')
  if (hands.some((h) => !/^S[2-9TJQKA]*H[2-9TJQKA]*D[2-9TJQKA]*C[2-9TJQKA]*$/.test(h))) {
    throw new ParseError('board details: a hand is missing or not in S…H…D…C… form')
  }
  if (hands.join('').replace(/[SHDC]/g, '').length !== 52) {
    throw new ParseError('board details: the deal is not 52 cards')
  }
  const dealer = LIN_DEALER[deal.getAttribute('dealer')?.toLowerCase()]
  if (!dealer) throw new ParseError('board details: unknown dealer')
  const number = Number.parseInt(deal.getAttribute('board'), 10)
  if (!Number.isInteger(number)) throw new ParseError('board details: no board number')

  const names = ['south', 'west', 'north', 'east'].map((seat) =>
    clean(deal.getAttribute(`label${seat}`)).replace(/,/g, '')
  )
  const parts = [
    `pn|${names.join(',')}|`,
    `md|${dealer}${hands.map(sortHand).join(',')}|`,
    `sv|${LIN_VUL[deal.getAttribute('vul')?.toLowerCase()] ?? 'o'}|`,
    `ah|Board ${number}|`,
  ]
  for (const call of root.getElementsByTagName('sc_call_made')) {
    const value = call.getAttribute('call')
    if (!value) continue
    const alerted = call.getAttribute('alert') === 'Y'
    parts.push(`mb|${value}${alerted ? '!' : ''}|`)
    const explain = clean(call.getAttribute('explain'))
    if (explain) parts.push(`an|${explain}|`)
  }
  for (const card of root.getElementsByTagName('sc_card_played')) {
    const value = card.getAttribute('card')
    if (/^[SHDC][2-9TJQKA]$/.test(value ?? '')) parts.push(`pc|${value}|`)
  }
  return { hk: `live:${requestId}`, lin: parts.join(''), number }
}

/** The result as History's lists write it ("2SSx-1", "3NS+2", "4HW="), worked
 *  out from the play, or null when it can't be: passed out, or play cut short
 *  (a claim, whose tricks this message does not carry). */
export function resultOf({ contract, declarer, tricksWon }) {
  const m = /^([1-7])(NT|[CDHS])(X{0,2})$/.exec(contract ?? '')
  if (!m || !declarer || !Number.isInteger(tricksWon)) return null
  const level = Number(m[1])
  const over = tricksWon - (level + 6)
  const doubled = m[3].toLowerCase()
  const strain = m[2] === 'NT' ? 'N' : m[2]
  return `${level}${strain}${declarer}${doubled}${over === 0 ? '=' : over > 0 ? `+${over}` : over}`
}

const SIDE = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' }

/** A board's result from its LIN, as resultOf writes it; null as resultOf. */
export function resultOfLin(lin) {
  const parsed = parseLin(lin)
  const { contract, declarer } = deriveContract(parsed.auction, parsed.dealer)
  if (!contract || !declarer || parsed.play.length !== 52) return null
  const seatOfCard = {}
  for (const seat of ['N', 'E', 'S', 'W']) {
    for (const suit of ['S', 'H', 'D', 'C']) {
      for (const r of parsed.deal[seat][suit]) seatOfCard[solverCard(suit + r)] = seat
    }
  }
  const trace = parsed.play.map((c) => ({ card: solverCard(c), seat: seatOfCard[solverCard(c)] }))
  const winners = trickWinners(trace, trumpOf(contract))
  const tricksWon = winners.filter((card) => SIDE[seatOfCard[card]] === SIDE[declarer]).length
  return resultOf({ contract, declarer, tricksWon })
}

// ── Robot games (daylongs) ───────────────────────────────────────────────────
//
// A daylong is not played over the game connection: the deal and each robot's
// move come from bboardapi.bridgebase.com, and History's My Table is filled by
// one webutil ard.php request that answers every board of the event so far:
//
//   <deals request_id="" err="0" tid="9ca06e6d-…">
//     <deal round_number="1" board_number="3" south="kemistry" west="~robot" …
//           result="3CE=" dealstring="st||md|1SK8752…|sv|E|ah|Board 3|mb|1S|an|…|pc|D9|…|mc|9|" />
//   </deals>
//
// `dealstring` is LIN, as mh_hand.php gives it, without the pn| names, which
// sit on the element instead. Captured from a live daylong, 7 Nov 2026. BBO asks
// again after a reload, so the whole event comes back with it.

/** ard.php's <deals> → { tid, boards: [{ number, hk, lin, result, players }] }.
 *  A <deal> without a deal or a board number is left out, not guessed at. */
export function parseArdDeals(xml) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new ParseError('ard deals: expected a non-empty XML string')
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new ParseError('ard deals: not well-formed XML')
  }
  const root = doc.documentElement
  if (root?.tagName !== 'deals') {
    throw new ParseError(`ard deals: expected <deals>, got <${root?.tagName ?? 'nothing'}>`)
  }
  const tid = root.getAttribute('tid')
  if (!tid) throw new ParseError('ard deals: <deals> has no tid')
  const boards = []
  for (const deal of root.getElementsByTagName('deal')) {
    const number = Number.parseInt(deal.getAttribute('board_number'), 10)
    const dealstring = deal.getAttribute('dealstring') ?? ''
    if (!Number.isInteger(number) || !/(^|\|)md\|[1-4]S/.test(dealstring)) continue
    const names = ['south', 'west', 'north', 'east'].map((seat) =>
      clean(deal.getAttribute(seat)).replace(/,/g, '')
    )
    const lin = `pn|${names.join(',')}|${dealstring.replace(/^st\|\|/, '')}`
    const [S, W, N, E] = names.map((n) => n || null)
    boards.push({
      number,
      hk: `ard:${tid}:${deal.getAttribute('round_number') ?? ''}:${number}`,
      lin,
      result: deal.getAttribute('result') || null,
      players: { N, E, S, W },
    })
  }
  return { tid, boards }
}
