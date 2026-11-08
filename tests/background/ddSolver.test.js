import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createDdSolver,
  isResultKey,
  CACHE_PREFIX,
  TALLY_PREFIX,
  MAX_BOARDS,
  LIVE_TABLE_KEY,
} from '../../src/background/ddSolver.js'
import { parseMhHand } from '../../src/adapters/bbo/parsers/mhXml.js'

const root = join(import.meta.dirname, '../..')
const board = (n) =>
  parseMhHand(readFileSync(join(root, `fixtures/bbo/mh-hand-33873-board${n}.xml`), 'utf8'))

// The real bridge-solver package (fetched by tests/setup/fetchSolverWasm.js).
async function loadSolver() {
  const glue = await import('../../src/vendor/solver-wasm/bridge_solver_wasm.js')
  glue.initSync({
    module: readFileSync(join(root, 'src/vendor/solver-wasm/bridge_solver_wasm_bg.wasm')),
  })
  return glue
}

function memoryStorage() {
  const data = {}
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data }
      const out = {}
      for (const k of [].concat(keys)) if (k in data) out[k] = data[k]
      return out
    },
    async set(obj) {
      Object.assign(data, obj)
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k]
    },
  }
}

describe('createDdSolver', () => {
  let storage, loads, solver, clock
  beforeEach(() => {
    storage = memoryStorage()
    loads = 0
    clock = Date.UTC(2026, 10, 1)
    solver = createDdSolver({
      loadSolver: () => {
        loads++
        return loadSolver()
      },
      storage,
      now: () => clock,
    })
  })

  it('board 1: 3NT makes 10 double-dummy, and the one error is West’s ♠J', async () => {
    const { hk, lin } = board(1)
    const entry = await solver.trace(hk, lin)
    expect(entry.contract).toBe('3NT')
    expect(entry.declarer).toBe('S')
    expect(entry.contract_tricks).toBe(10)
    expect(entry.trace).toHaveLength(52)
    expect(entry.trace.filter((t) => t.cost > 0)).toEqual([
      { index: 39, seat: 'W', card: 'SJ', cost: 1 },
    ])
  })

  it('board 5 (claimed after five tricks) is analysed as far as it was played', async () => {
    const { hk, lin } = board(5)
    const entry = await solver.trace(hk, lin)
    expect(entry.contract).toBe('6S')
    expect(entry.trace).toHaveLength(20)
  })

  it('solves a board once, then answers from the cache', async () => {
    const { hk, lin } = board(1)
    const first = await solver.trace(hk, lin)
    const again = await createDdSolver({
      loadSolver: () => {
        throw new Error('should not load')
      },
      storage,
    }).trace(hk, 'unused')
    expect(again).toEqual(first)
    expect(loads).toBe(1)
  })

  it('looks up only what is cached', async () => {
    const one = board(1),
      five = board(5)
    await solver.trace(one.hk, one.lin)
    const got = await solver.lookup([one.hk, five.hk, 'not a key'])
    expect(Object.keys(got)).toEqual([one.hk])
  })

  it('keeps no time limit, and removes entries from an older version', async () => {
    const ancient = CACHE_PREFIX + 'h/2/1-2-3/2020-01-01 10:00:00'
    const old = CACHE_PREFIX + 'h/3/1-2-3/2026-10-30 10:00:00'
    storage.data[ancient] = { v: 2, t: Date.UTC(2020, 0, 1), trace: [] }
    storage.data[old] = { v: 1, t: clock, trace: [], players: { N: 'someone' } }
    storage.data.unrelated = 1
    const { hk, lin } = board(1)
    await solver.trace(hk, lin)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(storage.data).sort()).toEqual(
      [ancient, CACHE_PREFIX + hk, 'unrelated'].sort()
    )
  })

  it('stores no player names', async () => {
    const { hk, lin } = board(1)
    const entry = await solver.trace(hk, lin, { tkey: '33873-1793548800', number: 1, mySeat: 'N' })
    expect(entry.players).toBeUndefined()
    expect(JSON.stringify(storage.data)).not.toMatch(/kemistry|aam135|missy2727|ARFBridge/i)
  })

  it('tallies a board against the event, from the seat it was given', async () => {
    const { hk, lin } = board(1) // the one error is West's
    const tkey = '33873-1793548800'
    await solver.trace(hk, lin, { tkey, number: 1, mySeat: 'N' })
    let t = await solver.tallies([tkey])
    expect(t[tkey].b[1]).toEqual([0, 0, 1])
    await solver.trace(hk, lin, { tkey, number: 1, mySeat: 'W' })
    t = await solver.tallies([tkey])
    expect(t[tkey].b[1]).toEqual([1, 0, 0])
  })

  it('keeps a tally when the board behind it is removed', async () => {
    const { hk, lin } = board(1)
    const tkey = '33873-1793548800'
    await solver.trace(hk, lin, { tkey, number: 1, mySeat: 'N' })
    await storage.remove(CACHE_PREFIX + hk)
    const t = await solver.tallies([tkey])
    expect(t[tkey].b[1]).toEqual([0, 0, 1])
  })

  it('an event: notes the board count and tallies what is already cached', async () => {
    const { hk, lin } = board(1)
    const tkey = '33873-1793548800'
    await solver.trace(hk, lin)
    const out = await solver.event(tkey, [
      { number: 1, resultkey: hk, mySeat: 'N' },
      { number: 2, resultkey: 'h/9/33873-1793548800-1/2026-11-01 16:08:40', mySeat: 'N' },
    ])
    expect(out.tally.total).toBe(2)
    expect(out.tally.b).toEqual({ 1: [0, 0, 1] })
    expect(Object.keys(out.entries)).toEqual([hk])
  })

  it('accepts a daylong, whose key is a different shape and which has no boards', async () => {
    const tkey = 'ARDARD:6f377b74.bf00.11f1.8901.ac1f6b5a106e-1791014401'
    const out = await solver.event(tkey, [])
    expect(out.tally).toEqual({ total: 0, b: {} })
  })

  it('tally changes made at the same moment do not lose one another', async () => {
    const tkey = '33873-1793548800'
    const { hk, lin } = board(1)
    const five = board(5)
    await Promise.all([
      solver.trace(hk, lin, { tkey, number: 1, mySeat: 'N' }),
      solver.trace(five.hk, five.lin, { tkey, number: 5, mySeat: 'N' }),
    ])
    const t = await solver.tallies([tkey])
    expect(Object.keys(t[tkey].b).sort()).toEqual(['1', '5'])
  })

  it('removes the oldest boards past the limit, leaving tallies alone', async () => {
    for (let i = 0; i < MAX_BOARDS + 10; i++) {
      storage.data[`${CACHE_PREFIX}h/${i}/1-2-3/2026-01-01 10:00:00`] = { v: 2, t: i, trace: [] }
    }
    storage.data[`${TALLY_PREFIX}1-2`] = { v: 1, total: 1, b: { 1: [0, 0, 0] } }
    const { hk, lin } = board(1)
    await solver.trace(hk, lin)
    await new Promise((r) => setTimeout(r, 0))
    const keys = Object.keys(storage.data)
    expect(keys.filter((k) => k.startsWith(CACHE_PREFIX)).length).toBe(MAX_BOARDS)
    expect(keys).not.toContain(`${CACHE_PREFIX}h/0/1-2-3/2026-01-01 10:00:00`)
    expect(keys).toContain(`${TALLY_PREFIX}1-2`)
  })

  it('a full cache makes room and tries again', async () => {
    for (let i = 0; i < 3100; i++) {
      storage.data[`${CACHE_PREFIX}h/${i}/1-2-3/2026-01-01 10:00:00`] = { v: 2, t: i, trace: [] }
    }
    const set = storage.set
    let refused = 0
    storage.set = async (obj) => {
      if (refused++ === 0) throw new Error('QUOTA_BYTES quota exceeded')
      return set(obj)
    }
    const { hk, lin } = board(1)
    await solver.trace(hk, lin)
    expect(storage.data[CACHE_PREFIX + hk]).toBeDefined()
  })

  it('a cache that refuses every write still returns the analysis', async () => {
    storage.set = async () => {
      throw new Error('QUOTA_BYTES quota exceeded')
    }
    const { hk, lin } = board(1)
    const entry = await solver.trace(hk, lin, { tkey: '33873-1793548800', number: 1, mySeat: 'N' })
    expect(entry.contract).toBe('3NT')
  })

  it('refuses a key that is not a BBO resultkey', async () => {
    await expect(solver.trace('../../etc', board(1).lin)).rejects.toThrow('resultkey')
    expect(isResultKey('h/4748677413/33873-1793548800-50407802/2026-11-01 16:04:55')).toBe(true)
  })

  it("accepts the event being played: the game connection's and a daylong's keys, seen 7 Nov 2026", () => {
    expect(isResultKey('live:d~t~52031~1~16~0')).toBe(true)
    expect(isResultKey('ard:9ca06e6d-da89-11f1-8901-ac1f6b5a106e:1:4')).toBe(true)
    expect(isResultKey('ard:../x:1:4')).toBe(false)
    expect(isResultKey('live:a/b')).toBe(false)
  })

  it("remembers the event being played, without names, so My Table's tags survive a reload", async () => {
    const key = 'live:d~t~52031~1~16~0'
    await solver.trace(key, board(1).lin)
    await solver.noteLive('52031~1', {
      number: 16,
      resultkey: key,
      result: '2SSx+1',
      mySeat: 'E',
      players: { N: 'someone' },
    })
    const table = await solver.liveTable()
    expect(table.event).toBe('52031~1')
    expect(table.boards).toEqual([{ number: 16, resultkey: key, result: '2SSx+1', mySeat: 'E' }])
    expect(table.entries[key].contract).toBe('3NT')
    expect(JSON.stringify(storage.data[LIVE_TABLE_KEY])).not.toContain('someone')

    // Another event starts afresh; twelve hours on, nothing is offered.
    await solver.noteLive('52032~1', { number: 1, resultkey: 'live:d~t~52032~1~1~0', result: null })
    expect((await solver.liveTable()).boards.map((b) => b.number)).toEqual([1])
    clock += 13 * 60 * 60 * 1000
    expect(await solver.liveTable()).toBeNull()
  })

  it('refuses a live board with a bad event or key', async () => {
    await expect(solver.noteLive('../x', { number: 1, resultkey: 'live:a~b' })).rejects.toThrow()
    await expect(solver.noteLive('52031~1', { number: 1, resultkey: '../x' })).rejects.toThrow()
    expect(storage.data[LIVE_TABLE_KEY]).toBeUndefined()
  })

  it('caches a passed-out board as having nothing to analyse', async () => {
    const entry = await solver.trace(
      'h/9/1-2-3/2026-11-01 10:00:00',
      'md|3S2,S3,S4,|mb|p|mb|p|mb|p|mb|p|'
    )
    expect(entry).toMatchObject({ contract: null, trace: [] })
    expect(loads).toBe(0)
  })

  it("gives the alternatives at an error: West's spade J, where only the heart Q held 10", async () => {
    const node = await solver.alternatives(board(1).lin, 39)
    expect(node).toMatchObject({ index: 39, seat: 'W', card: 'SJ', cost: 1 })
    expect(node.alternatives).toEqual([
      { card: 'SK', tricks: 11, cost: 1 },
      { card: 'SJ', tricks: 11, cost: 1 },
      { card: 'HA', tricks: 11, cost: 1 },
      { card: 'HQ', tricks: 10, cost: 0 },
    ])
    expect(await solver.alternatives(board(1).lin, 52)).toBeNull()
  })
})
