// Per-card double-dummy for BBO History boards, solved in the user's browser.
//
// bridge-solver's WASM `Analyzer.dd_play` scores every card played: how many
// tricks it cost its side against double-dummy-perfect play. It is the same code
// the solver service runs, and a full 52-card board takes tens of milliseconds,
// so nothing leaves the device.
//
// Results are cached in extension storage, keyed by BBO's resultkey, for
// CACHE_DAYS. A finished board never changes, so a cached trace is final: going
// back to an event from earlier in the week redraws without solving anything.

import { buildPlayRequest } from '../lib/ddPlay.js'

export const CACHE_PREFIX = 'dd:'
export const CACHE_DAYS = 14
const CACHE_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000

// A resultkey looks like "h/4748677413/33873-1793548800-50407802/2026-11-01 16:04:55".
// It comes from the page, so it is checked before it becomes a storage key.
const RESULTKEY_RE = /^h\/\d+\/[\w-]+\/[\d :-]+$/

export function isResultKey(key) {
  return typeof key === 'string' && key.length < 200 && RESULTKEY_RE.test(key)
}

/** `loadSolver()` resolves to the WASM module's exports ({ Analyzer }); it is
 *  called once, on first use. `storage` is extension storage.local. */
export function createDdSolver({ loadSolver, storage, now = () => Date.now() }) {
  let solver = null
  let swept = false

  async function getSolver() {
    solver ??= loadSolver().catch((err) => {
      solver = null // let the next board try again
      throw err
    })
    return solver
  }

  async function sweep() {
    if (swept) return
    swept = true
    const all = await storage.get(null)
    const cutoff = now() - CACHE_DAYS * DAY_MS
    const stale = Object.keys(all).filter(
      (k) => k.startsWith(CACHE_PREFIX) && !(all[k]?.t > cutoff && all[k]?.v === CACHE_VERSION)
    )
    if (stale.length) await storage.remove(stale)
  }

  /** The analysis of one board, from cache or solved now.
   *  Returns { contract, declarer, players, contract_tricks, trace } — with
   *  contract null for a board with nothing to analyse (passed out). */
  async function trace(resultkey, lin) {
    if (!isResultKey(resultkey)) throw new Error('not a BBO resultkey')
    const key = CACHE_PREFIX + resultkey
    const hit = (await storage.get(key))[key]
    if (hit?.v === CACHE_VERSION) return strip(hit)

    const built = buildPlayRequest(lin)
    let entry
    if (!built) {
      entry = { contract: null, declarer: null, players: null, contract_tricks: null, trace: [] }
    } else {
      const { Analyzer } = await getSolver()
      const analyzer = new Analyzer()
      try {
        const out = JSON.parse(analyzer.dd_play(JSON.stringify(built.request)))
        entry = {
          contract: built.contract,
          declarer: built.declarer,
          players: built.players,
          contract_tricks: out.contract_tricks,
          trace: out.trace.map(({ index, seat, card, cost }) => ({ index, seat, card, cost })),
        }
      } finally {
        analyzer.free?.()
      }
    }
    await storage.set({ [key]: { v: CACHE_VERSION, t: now(), ...entry } })
    sweep().catch(() => {})
    return entry
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

  return { trace, lookup, alternatives }
}

function strip({ v, t, ...entry }) {
  return entry
}
