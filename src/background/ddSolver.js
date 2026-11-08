// Per-card double-dummy for BBO History boards, solved in the user's browser.
//
// bridge-solver's WASM `Analyzer.dd_play` scores every card played: how many
// tricks it cost its side against double-dummy-perfect play. It is the same code
// the solver service runs, and a full 52-card board takes tens of milliseconds,
// so nothing leaves the device.
//
// Two kinds of record live in extension storage, on the device:
//
//   dd:<resultkey>  one board's full analysis: what redraws a board instantly.
//                   About 2.5 KB. Oldest deleted first when space runs short.
//   ddt:<tkey>      one event's tally: errors per board by you, your partner and
//                   the opponents. About 200 bytes, and kept.
//
// Neither names a player. BBO keeps these games for years, so a deleted board
// costs nothing but a solve the next time it is opened. Chrome allows 10 MB by
// default; MAX_BOARDS keeps boards well inside that, so the hand-off and the
// settings that share the space are never the ones refused.

import { buildPlayRequest, summarizeTrace } from '../lib/ddPlay.js'

export const CACHE_PREFIX = 'dd:'
export const TALLY_PREFIX = 'ddt:'
// The event being played: which of its boards have been seen, so My Table's tags
// survive a reload. One record, for the latest event only, and short-lived.
export const LIVE_TABLE_KEY = 'ddl:table'
const LIVE_TABLE_TTL = 12 * 60 * 60 * 1000
const LIVE_EVENT_RE = /^[\w~.-]{1,80}$/
const LIVE_RESULT_RE = /^[\w=+-]{1,20}$/
export const MAX_BOARDS = 3500
const PRUNE_TO = 3000
const PRUNE_EVERY = 200
const CACHE_VERSION = 2
// 2: a robot partner's declaring counts as the user's (8 Nov 2026).
const TALLY_VERSION = 2

// A resultkey looks like "h/4748677413/33873-1793548800-50407802/2026-11-01 16:04:55".
// Two other shapes, seen 8 Nov 2026, both answered by mh_hand.php:
//   an instant tournament   "h/4751965667/SB:kemistry-1794151716-1/2026-11-08 15:31:33"
//   a finished daylong      "ARD/INSTANCE-T52462824-R1-B5-I2/kemistry/52462824"
// Turning these away cost each such event every board: its tally was written as
// zero boards, shown as "–", and DD all counted it complete.
// It comes from the page, so it is checked before it becomes a storage key.
const RESULTKEY_RE = /^(h\/\d+\/[\w:.-]+\/[\d :-]+|ARD\/[\w-]+\/[\w.~+-]+\/\d+)$/
// The event being played has no such key yet, so its boards carry one made from
// what BBO sent: "live:d~t~52031~1~16~0" from the game connection (the request's
// own id), "ard:<tid>:<round>:<board>" from a daylong's ard.php.
const LIVE_KEY_RE = /^(live:[\w~]+|ard:[\w-]+:\d*:\d+)$/

export function isResultKey(key) {
  return (
    typeof key === 'string' && key.length < 200 && (RESULTKEY_RE.test(key) || LIVE_KEY_RE.test(key))
  )
}

// An event's key: "33873-1793548800", or for a daylong
// "ARDARD:6f377b74.bf00.11f1.8901.ac1f6b5a106e-1791014401". Also from the page.
const TKEY_RE = /^[\w:.]+-\d+$/

export function isTkey(key) {
  return typeof key === 'string' && key.length < 100 && TKEY_RE.test(key)
}

// [me, partner, opponents] errors on one board. Null when the seat is unknown.
function tallyOf(entry, mySeat, robotPartner = false) {
  if (!mySeat) return null
  if (!entry.contract) return [0, 0, 0]
  const { counts } = summarizeTrace(entry.trace, {
    declarer: entry.declarer,
    mySeat,
    robotPartner: robotPartner === true,
  })
  return counts ? [counts.me.errors, counts.partner.errors, counts.opps.errors] : null
}

/** `loadSolver()` resolves to the WASM module's exports ({ Analyzer }); it is
 *  called once, on first use. `storage` is extension storage.local. */
export function createDdSolver({ loadSolver, storage, now = () => Date.now() }) {
  let solver = null
  let writes = 0

  async function getSolver() {
    solver ??= loadSolver().catch((err) => {
      solver = null // let the next board try again
      throw err
    })
    return solver
  }

  /** Down to `keep` boards, oldest first, and anything from an older version. */
  async function prune(keep) {
    const all = await storage.get(null)
    const boards = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX))
    const stale = boards.filter((k) => all[k]?.v !== CACHE_VERSION)
    const current = boards
      .filter((k) => all[k]?.v === CACHE_VERSION)
      .sort((a, b) => (all[a].t ?? 0) - (all[b].t ?? 0))
    const over = current.slice(0, Math.max(0, current.length - keep))
    const gone = [...stale, ...over]
    if (gone.length) await storage.remove(gone)
  }

  // A write that fails must not cost the user the answer already in hand. Refused
  // for space, make room and try once more; refused again, go without the cache.
  async function save(record) {
    try {
      await storage.set(record)
    } catch {
      try {
        await prune(PRUNE_TO)
        await storage.set(record)
      } catch (err) {
        console.warn('[bc] double-dummy cache write refused:', err?.message ?? err)
      }
    }
  }

  // Tallies are read, changed and written back, and boards arrive concurrently,
  // so changes to them take turns.
  let tallyTurn = Promise.resolve()
  function changeTally(tkey, change) {
    const key = TALLY_PREFIX + tkey
    const run = tallyTurn.then(async () => {
      const held = (await storage.get(key))[key]
      const record = held?.v === TALLY_VERSION ? held : { v: TALLY_VERSION, total: null, b: {} }
      if (change(record) === false) return strip(record)
      await save({ [key]: record })
      return strip(record)
    })
    tallyTurn = run.catch(() => {})
    return run
  }

  async function solveBoard(lin) {
    const built = buildPlayRequest(lin)
    if (!built) return { contract: null, declarer: null, contract_tricks: null, trace: [] }
    const { Analyzer } = await getSolver()
    const analyzer = new Analyzer()
    try {
      const out = JSON.parse(analyzer.dd_play(JSON.stringify(built.request)))
      return {
        contract: built.contract,
        declarer: built.declarer,
        contract_tricks: out.contract_tricks,
        trace: out.trace.map(({ index, seat, card, cost }) => ({ index, seat, card, cost })),
      }
    } finally {
      analyzer.free?.()
    }
  }

  /** The analysis of one board, from cache or solved now.
   *  Returns { contract, declarer, contract_tricks, trace } — with contract null
   *  for a board with nothing to analyse (passed out). `place`, when known, is
   *  { tkey, number, mySeat }: where the board's errors go in its event's tally. */
  async function trace(resultkey, lin, place = null) {
    if (!isResultKey(resultkey)) throw new Error('not a BBO resultkey')
    const key = CACHE_PREFIX + resultkey
    const hit = (await storage.get(key))[key]
    let entry
    if (hit?.v === CACHE_VERSION) {
      entry = strip(hit)
    } else {
      entry = await solveBoard(lin)
      await save({ [key]: { v: CACHE_VERSION, t: now(), ...entry } })
      if (writes++ % PRUNE_EVERY === 0) {
        prune(MAX_BOARDS).catch(() => {})
      }
    }
    const tally =
      place && isTkey(place.tkey) ? tallyOf(entry, place.mySeat, place.robotPartner) : null
    if (tally) {
      await changeTally(place.tkey, (record) => {
        record.b[place.number] = tally
      })
    }
    return entry
  }

  /** An event's board list has been seen: note how many boards it has, tally any
   *  of them already in the cache, and return { entries, tally }. `boards` is
   *  [{ number, resultkey, mySeat }]. */
  async function event(tkey, boards) {
    if (!isTkey(tkey)) throw new Error('not a BBO event key')
    const list = (Array.isArray(boards) ? boards : []).filter((b) => isResultKey(b?.resultkey))
    const entries = await lookup(list.map((b) => b.resultkey))
    const tally = await changeTally(tkey, (record) => {
      let changed = record.total !== list.length
      record.total = list.length
      for (const board of list) {
        const entry = entries[board.resultkey]
        const counted =
          entry && !record.b[board.number] && tallyOf(entry, board.mySeat, board.robotPartner)
        if (counted) {
          record.b[board.number] = counted
          changed = true
        }
      }
      return changed
    })
    return { entries, tally }
  }

  /** The tallies held for these events: { [tkey]: { total, b } }. Events never
   *  opened are simply absent. */
  async function tallies(tkeys) {
    const keys = (Array.isArray(tkeys) ? tkeys : []).filter(isTkey)
    if (!keys.length) return {}
    const got = await storage.get(keys.map((k) => TALLY_PREFIX + k))
    const out = {}
    for (const k of keys) {
      const held = got[TALLY_PREFIX + k]
      if (held?.v === TALLY_VERSION) out[k] = strip(held)
    }
    return out
  }

  /** Whatever the cache already holds for these boards: { [resultkey]: entry }.
   *  Boards not yet seen are simply absent. */
  async function lookup(resultkeys) {
    const keys = (Array.isArray(resultkeys) ? resultkeys : []).filter(isResultKey)
    if (!keys.length) return {}
    const got = await storage.get(keys.map((k) => CACHE_PREFIX + k))
    const out = {}
    for (const k of keys) {
      const hit = got[CACHE_PREFIX + k]
      if (hit?.v === CACHE_VERSION) out[k] = strip(hit)
    }
    return out
  }

  /** Every legal card at play `node` (0-based) of the board, each with what
   *  it would have cost: bridge-solver's dd_play_node, for showing what an
   *  error should have been. Small, so solved on demand and not cached here. */
  async function alternatives(lin, node) {
    const built = buildPlayRequest(lin)
    if (!built || !Number.isInteger(node) || node < 0 || node >= built.request.plays.length) {
      return null
    }
    const { Analyzer } = await getSolver()
    const analyzer = new Analyzer()
    try {
      const out = JSON.parse(analyzer.dd_play_node(JSON.stringify(built.request), node))
      return {
        index: out.index,
        seat: out.seat,
        card: out.card,
        cost: out.cost,
        alternatives: out.alternatives.map(({ card, tricks, cost }) => ({ card, tricks, cost })),
      }
    } finally {
      analyzer.free?.()
    }
  }

  /** A board of the event being played has been seen: remember its number, key,
   *  result and the user's seat, and nothing else (no names). A board from
   *  another event starts the record afresh. */
  let liveTurn = Promise.resolve()
  function noteLive(liveEvent, board) {
    const number = board?.number
    if (!LIVE_EVENT_RE.test(liveEvent ?? '')) return Promise.reject(new Error('not an event'))
    if (!Number.isInteger(number) || number < 1 || number > 999 || !isResultKey(board.resultkey)) {
      return Promise.reject(new Error('not a board'))
    }
    const run = liveTurn.then(async () => {
      const held = (await storage.get(LIVE_TABLE_KEY))[LIVE_TABLE_KEY]
      const record = held?.event === liveEvent ? held : { event: liveEvent, t: now(), boards: {} }
      record.boards[number] = {
        resultkey: board.resultkey,
        result: LIVE_RESULT_RE.test(board.result ?? '') ? board.result : null,
        mySeat: ['N', 'E', 'S', 'W'].includes(board.mySeat) ? board.mySeat : null,
        robotPartner: board.robotPartner === true,
      }
      record.t = now()
      await save({ [LIVE_TABLE_KEY]: record })
    })
    liveTurn = run.catch(() => {})
    return run
  }

  /** What noteLive remembered, with the analyses already cached: { event,
   *  boards: [{ number, resultkey, result, mySeat }], entries }, or null when
   *  nothing was seen in the last twelve hours. */
  async function liveTable() {
    const held = (await storage.get(LIVE_TABLE_KEY))[LIVE_TABLE_KEY]
    if (!held?.boards || !(now() - (held.t ?? 0) < LIVE_TABLE_TTL)) return null
    const boards = Object.entries(held.boards).map(([n, b]) => ({ number: Number(n), ...b }))
    const entries = await lookup(boards.map((b) => b.resultkey))
    return { event: held.event, boards, entries }
  }

  return { trace, event, tallies, lookup, alternatives, noteLive, liveTable }
}

function strip({ v, t, ...entry }) {
  return entry
}
