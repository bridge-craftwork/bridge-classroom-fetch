import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDdSolver, isResultKey, CACHE_PREFIX } from '../../src/background/ddSolver.js'
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

  it('drops entries older than the cache period', async () => {
    storage.data[CACHE_PREFIX + 'h/1/1-2-3/2026-10-01 10:00:00'] = {
      v: 1,
      t: clock - 15 * 86400000,
      trace: [],
    }
    storage.data[CACHE_PREFIX + 'h/2/1-2-3/2026-10-30 10:00:00'] = {
      v: 1,
      t: clock - 2 * 86400000,
      trace: [],
    }
    storage.data['unrelated'] = 1
    const { hk, lin } = board(1)
    await solver.trace(hk, lin)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(storage.data).sort()).toEqual(
      [CACHE_PREFIX + hk, CACHE_PREFIX + 'h/2/1-2-3/2026-10-30 10:00:00', 'unrelated'].sort()
    )
  })

  it('refuses a key that is not a BBO resultkey', async () => {
    await expect(solver.trace('../../etc', board(1).lin)).rejects.toThrow('resultkey')
    expect(isResultKey('h/4748677413/33873-1793548800-50407802/2026-11-01 16:04:55')).toBe(true)
  })

  it('caches a passed-out board as having nothing to analyse', async () => {
    const entry = await solver.trace(
      'h/9/1-2-3/2026-11-01 10:00:00',
      'md|3S2,S3,S4,|mb|p|mb|p|mb|p|mb|p|'
    )
    expect(entry).toMatchObject({ contract: null, trace: [] })
    expect(loads).toBe(0)
  })
})
