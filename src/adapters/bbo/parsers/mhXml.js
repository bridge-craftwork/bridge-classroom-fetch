// Parse the two XML responses behind the v3 client's History panel:
//
//   webutil.bridgebase.com/v2/mh_list.php  — one event's boards for one player
//   webutil.bridgebase.com/v2/mh_hand.php  — one board's LIN, play included
//
// Neither is fetched by us. BBO's own History panel requests them as the user
// opens an event and its boards, and the page hook (public/bbo-page-hook.js)
// hands us copies. See docs/data-sources.md § 3.9.
//
// The bodies arrive via window.postMessage from the page, so they are treated as
// untrusted text: parsed as XML, never as HTML, and shape-checked.

import { ParseError } from '../../../lib/parseError.js'

const SEATS = ['north', 'east', 'south', 'west']

function parseXml(xml, what) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new ParseError(`${what}: expected a non-empty XML string`)
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new ParseError(`${what}: response is not well-formed XML`)
  }
  return doc
}

/** mh_list.php → the event's boards, each with the key that fetches its hand.
 *
 *  Returns { tkey, username, boards: [{ number, resultkey, result, scoring,
 *  players: { N, E, S, W } }] }, boards in board order. A board the user did
 *  not play has no <sc_result> and is left out rather than invented. */
export function parseMhList(xml) {
  const doc = parseXml(xml, 'mh_list')
  const root = doc.documentElement
  if (root?.tagName !== 'sc_boards') {
    throw new ParseError(`mh_list: expected <sc_boards>, got <${root?.tagName ?? 'nothing'}>`)
  }
  const boards = []
  for (const board of root.getElementsByTagName('sc_board')) {
    const number = Number.parseInt(board.getAttribute('number'), 10)
    const res = board.getElementsByTagName('sc_result')[0]
    if (!Number.isInteger(number) || !res) continue
    const resultkey = res.getAttribute('resultkey')
    if (!resultkey) continue
    const players = {}
    for (const seat of SEATS) players[seat[0].toUpperCase()] = res.getAttribute(seat) || null
    boards.push({
      number,
      resultkey,
      result: res.getAttribute('result') || null,
      scoring: res.getAttribute('scoring') || null,
      players,
    })
  }
  return {
    tkey: root.getAttribute('tkey') || null,
    username: root.getAttribute('username') || null,
    boards,
  }
}

/** mh_hand.php → { hk, lin }. BBO answers a bad key with <status err="1">,
 *  which is reported rather than parsed as an empty hand. */
export function parseMhHand(xml) {
  const doc = parseXml(xml, 'mh_hand')
  const root = doc.documentElement
  if (root?.tagName === 'status') {
    throw new ParseError(`mh_hand: BBO said ${root.getAttribute('errmsg') || 'error'}`)
  }
  if (root?.tagName !== 'linhand') {
    throw new ParseError(`mh_hand: expected <linhand>, got <${root?.tagName ?? 'nothing'}>`)
  }
  const hk = root.getAttribute('hk')
  const lin = root.textContent.trim()
  if (!hk) throw new ParseError('mh_hand: <linhand> has no hk')
  if (!lin.includes('md|')) throw new ParseError('mh_hand: <linhand> carries no deal')
  return { hk, lin }
}
