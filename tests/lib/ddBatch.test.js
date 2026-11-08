import { describe, it, expect, vi } from 'vitest'
import { analyzeEvents, eventsToRun, fetchEventList, isComplete } from '../../src/lib/ddBatch.js'

const event = (tkey, started = 1000) => ({
  tkey,
  username: 'me',
  format: 'pairs',
  teamname: 'me+pd',
  started,
})
const listOf = (...numbers) => ({ boards: numbers.map((n) => ({ number: n, resultkey: `k${n}` })) })

function setup({ lists = {}, tallies = new Map(), overrides = {} } = {}) {
  const calls = { list: [], hand: [], solved: [], sleeps: 0 }
  return {
    calls,
    args: {
      tallies,
      fetchList: async (e) => {
        calls.list.push(e.tkey)
        return lists[e.tkey] ?? listOf(1, 2)
      },
      fetchHand: async (hk) => {
        calls.hand.push(hk)
        return { hk }
      },
      noteList: async (e) => tallies.get(e.tkey) ?? { total: null, b: {} },
      solve: async (hand) => calls.solved.push(hand.hk),
      sleep: async () => calls.sleeps++,
      ...overrides,
    },
  }
}

describe('isComplete', () => {
  it('needs a board count, and every board counted', () => {
    expect(isComplete(undefined)).toBe(false)
    expect(isComplete({ total: null, b: {} })).toBe(false)
    expect(isComplete({ total: 2, b: { 1: [0, 0, 0] } })).toBe(false)
    expect(isComplete({ total: 2, b: { 1: [0, 0, 0], 2: [1, 0, 0] } })).toBe(true)
  })

  it('asks again about a young event with no boards: a daylong lists none until it ends', () => {
    const now = Date.UTC(2026, 10, 8)
    const day = 24 * 60 * 60 * 1000
    expect(isComplete({ total: 0, b: {} }, { started: now - day }, now)).toBe(false)
    // BBO drops a daylong's boards within weeks: an old empty answer is final.
    expect(isComplete({ total: 0, b: {} }, { started: now - 36 * day }, now)).toBe(true)
    expect(isComplete({ total: 0, b: {} })).toBe(true)
  })
})

describe('eventsToRun', () => {
  it('takes what is incomplete and recent enough', () => {
    const tallies = new Map([['done-1', { total: 1, b: { 1: [0, 0, 0] } }]])
    const events = [event('done-1', 5000), event('new-2', 5000), event('old-3', 10)]
    expect(eventsToRun(events, tallies, 100).map((e) => e.tkey)).toEqual(['new-2'])
    expect(eventsToRun(events, tallies).map((e) => e.tkey)).toEqual(['new-2', 'old-3'])
  })
})

describe('analyzeEvents', () => {
  it('fetches the list then each board, one at a time and paced', async () => {
    const { calls, args } = setup()
    const out = await analyzeEvents({ events: [event('a-1')], ...args })
    expect(calls.list).toEqual(['a-1'])
    expect(calls.hand).toEqual(['k1', 'k2'])
    expect(calls.solved).toEqual(['k1', 'k2'])
    expect(calls.sleeps).toBe(2) // between three requests
    expect(out).toMatchObject({ boards: 2, failed: 0, stopped: false })
  })

  it('asks nothing for a complete event', async () => {
    const tallies = new Map([['a-1', { total: 1, b: { 1: [0, 0, 0] } }]])
    const { calls, args } = setup({ tallies })
    await analyzeEvents({ events: [event('a-1')], ...args })
    expect(calls.list).toEqual([])
    expect(calls.hand).toEqual([])
  })

  it('skips boards already tallied', async () => {
    const tallies = new Map([['a-1', { total: 2, b: { 1: [0, 0, 0] } }]])
    const { calls, args } = setup({ tallies })
    await analyzeEvents({ events: [event('a-1')], ...args })
    expect(calls.hand).toEqual(['k2'])
  })

  it('stops when told, between requests', async () => {
    const { calls, args } = setup()
    let n = 0
    const out = await analyzeEvents({
      events: [event('a-1'), event('b-2')],
      ...args,
      shouldStop: () => ++n > 2,
    })
    expect(out.stopped).toBe(true)
    expect(calls.hand).toEqual(['k1'])
    expect(calls.list).toEqual(['a-1'])
  })

  it('skips one bad board and carries on', async () => {
    const { calls, args } = setup({ lists: { 'a-1': listOf(1, 2, 3) } })
    args.fetchHand = async (hk) => {
      if (hk === 'k2') throw new Error('bad')
      calls.hand.push(hk)
      return { hk }
    }
    const out = await analyzeEvents({ events: [event('a-1')], ...args })
    expect(calls.solved).toEqual(['k1', 'k3'])
    expect(out).toMatchObject({ boards: 2, failed: 1, error: 'bad', stopped: false })
  })

  it('gives up after three failures in a row, not asking BBO again', async () => {
    const fetchHand = vi.fn(async () => {
      throw new Error('BBO answered 429 for mh_hand.php')
    })
    const { args } = setup({ lists: { 'a-1': listOf(1, 2, 3, 4, 5) } })
    args.fetchHand = fetchHand
    const fetchList = vi.spyOn(args, 'fetchList')
    const out = await analyzeEvents({ events: [event('a-1'), event('b-2')], ...args })
    expect(fetchHand).toHaveBeenCalledTimes(3)
    expect(fetchList).toHaveBeenCalledTimes(1)
    expect(out.failed).toBe(3)
  })
})

describe('fetchEventList', () => {
  it("asks as BBO's panel does, without cookies", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '<x/>' }))
    await fetchEventList(fetchImpl, event('33879-1793552400'))
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://webutil.bridgebase.com/v2/mh_list.php')
    expect(init.credentials).toBe('omit')
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      tkey: '33879-1793552400',
      username: 'me',
      format: 'pairs',
      teamname: 'me+pd',
      merge: 'n',
    })
  })

  it('reports a refusal rather than parsing it', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429 })
    await expect(fetchEventList(fetchImpl, event('a-1'))).rejects.toThrow(/429/)
  })
})
