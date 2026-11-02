// DD-all: analyse every board of the chosen events, from BBO's public History
// endpoints (docs/data-sources.md § 3.9). The one place the extension asks BBO for
// anything itself, and only when the user chooses to.
//
// One request at a time, a second apart. BBO keeps these games for years, so a
// stopped or failed run loses nothing: the next one carries on from the tallies,
// and an event already complete costs no requests at all.

export const PACE_MS = 1000
// Three failures in a row is BBO saying something, and carrying on would only be
// rude. A single bad board is skipped and leaves its event marked incomplete.
const MAX_FAILURES_IN_A_ROW = 3

/** Every board of the event is counted. An event with no boards to analyse (a
 *  daylong, whose boards BBO's History does not list) counts as complete. */
export function isComplete(tally) {
  return !!tally && tally.total !== null && Object.keys(tally.b).length >= tally.total
}

/** The events to run: from `since` (epoch ms, or null for all), not yet complete. */
export function eventsToRun(events, tallies, since = null) {
  return (events ?? []).filter(
    (e) => !isComplete(tallies.get(e.tkey)) && (since === null || (e.started ?? 0) >= since)
  )
}

/** `tallies` is a Map of tkey → tally, read as each event starts. `fetchList(event)`
 *  and `fetchHand(hk)` ask BBO; `noteList(event, list)` resolves to the event's
 *  tally; `solve(hand, event, board)` analyses a board and records it.
 *  Returns { boards, failed, stopped, error }. */
export async function analyzeEvents({
  events,
  tallies,
  fetchList,
  fetchHand,
  noteList,
  solve,
  sleep,
  shouldStop = () => false,
  onProgress = () => {},
  pace = PACE_MS,
}) {
  const out = { boards: 0, failed: 0, stopped: false, error: null }
  let inARow = 0
  let requested = false

  // Paced, stoppable, and counting failures: false means give up on this item.
  async function ask(fn) {
    if (requested) await sleep(pace)
    requested = true
    if (shouldStop()) {
      out.stopped = true
      return undefined
    }
    try {
      const value = await fn()
      inARow = 0
      return value
    } catch (err) {
      out.failed++
      out.error = err?.message ?? String(err)
      inARow++
      return undefined
    }
  }
  const finished = () => out.stopped || inARow >= MAX_FAILURES_IN_A_ROW

  for (let i = 0; i < events.length && !finished(); i++) {
    const event = events[i]
    if (isComplete(tallies.get(event.tkey))) continue
    onProgress({ event, eventIndex: i, eventCount: events.length, done: 0, total: null })
    const list = await ask(() => fetchList(event))
    if (!list) continue
    const tally = await noteList(event, list)
    const todo = list.boards.filter((b) => !tally?.b?.[b.number])
    const total = list.boards.length
    let done = total - todo.length
    for (const board of todo) {
      onProgress({ event, eventIndex: i, eventCount: events.length, done, total })
      const hand = await ask(() => fetchHand(board.resultkey))
      if (finished()) break
      if (!hand) continue
      try {
        await solve(hand, event, board)
        out.boards++
        done++
      } catch (err) {
        out.failed++
        out.error = err?.message ?? String(err)
      }
    }
    onProgress({ event, eventIndex: i, eventCount: events.length, done, total })
  }
  return out
}

const HISTORY = 'https://webutil.bridgebase.com/v2/'

async function post(fetchImpl, page, fields) {
  const res = await fetchImpl(HISTORY + page, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`BBO answered ${res.status} for ${page}`)
  return res.text()
}

/** The same requests BBO's own History panel makes. Public, and sent without
 *  cookies: nothing here acts as the signed-in user. */
export const fetchEventList = (fetchImpl, event) =>
  post(fetchImpl, 'mh_list.php', {
    tkey: event.tkey,
    username: event.username,
    format: event.format,
    teamname: event.teamname,
    merge: 'n',
  })

export const fetchBoard = (fetchImpl, hk) => post(fetchImpl, 'mh_hand.php', { hk })
