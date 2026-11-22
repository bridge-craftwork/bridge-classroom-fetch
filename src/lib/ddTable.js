// A solved double-dummy table as display rows: the same grid Bridge Classroom's
// DoubleDummyTable draws, so a board reads the same in BBO as in the classroom.
//
// Ported from bridge-solver's web/src/lib/ddTable.js (itself vendored from
// Bridge Classroom's utils/handAnalysis.js), which already takes the engine's
// table shape. One addition: `isPar`, from the solver's par contracts, which
// the classroom marks with a bidding engine's contract instead.
//
// Two orders, and both matter. The engine returns rows N, E, S, W; a
// double-dummy table is always read N, S, E, W, partners adjacent, which is what
// makes the collapse legible.

const ENGINE_SEATS = ['N', 'E', 'S', 'W']
export const DISPLAY_SEATS = ['N', 'S', 'E', 'W']
/** Column order, low strain first: the engine's, and the display's. */
export const DISPLAY_STRAINS = ['C', 'D', 'H', 'S', 'NT']

const SIDES = { NS: ['N', 'S'], EW: ['E', 'W'], N: ['N'], S: ['S'], E: ['E'], W: ['W'] }

function strainIndex(text) {
  const raw = String(text ?? '').toUpperCase()
  return DISPLAY_STRAINS.indexOf(raw === 'N' ? 'NT' : raw)
}

/** The solver's par_contract ("NS 4S=", "EW 5DX-2; NS 5C=", "N 3N=") → the
 *  cells it names: [{ seats, strain, contract }], strain a DISPLAY_STRAINS index.
 *  A pair names both its seats; a single seat means only that partner makes it.
 *  Anything unreadable is skipped, and none (passed out) is []. */
export function parseParContracts(parContract) {
  if (typeof parContract !== 'string') return []
  const out = []
  for (const part of parContract.split(';')) {
    const m = /^\s*(NS|EW|[NESW])\s+([1-7])(NT|N|[CDHS])(X{0,2})/i.exec(part)
    if (!m) continue
    const strain = strainIndex(m[3])
    if (strain < 0) continue
    const name = DISPLAY_STRAINS[strain]
    out.push({
      seats: SIDES[m[1].toUpperCase()],
      strain,
      contract: m[2] + name + m[4].toUpperCase(),
    })
  }
  return out
}

/** Build the display grid, marking the contract's cell and the par cells.
 *
 *  `tricks` is the engine's tricks[seat][strain]: rows N, E, S, W; columns
 *  C, D, H, S, NT. Returns null for a missing or malformed table: a partial one
 *  would render as a grid of confident zeros, and no table is the honest
 *  rendering. */
export function buildDdRows(tricks, { contract = '', declarer = '', par = null } = {}) {
  if (!Array.isArray(tricks) || tricks.length !== 4) return null
  if (!tricks.every((row) => Array.isArray(row) && row.length === 5)) return null
  if (!tricks.every((row) => row.every((n) => Number.isInteger(n) && n >= 0 && n <= 13))) {
    return null
  }

  const m = /^[1-7](NT|N|[CDHS])/i.exec(String(contract ?? '').trim())
  const contractStrain = m ? strainIndex(m[1]) : -1
  const declarerSeat = String(declarer ?? '').toUpperCase()
  const pars = parseParContracts(par)

  return DISPLAY_SEATS.map((seat) => ({
    seat,
    cells: tricks[ENGINE_SEATS.indexOf(seat)].map((n, ci) => ({
      tricks: n,
      isContract: seat === declarerSeat && ci === contractStrain,
      isPar: pars.some((p) => p.strain === ci && p.seats.includes(seat)),
    })),
  }))
}

/** Merge a partnership's rows when every cell matches: N+S → NS, E+W → EW.
 *  Lossless, since a pair merges only when nothing differs, and it halves the
 *  height in the common case. The marks survive as the OR of the pair. */
export function collapseDdRows(rows) {
  if (!rows) return rows
  const bySeat = Object.fromEntries(rows.map((r) => [r.seat, r]))
  const same = (a, b) =>
    a &&
    b &&
    a.cells.length === b.cells.length &&
    a.cells.every((c, i) => c.tricks === b.cells[i].tricks)
  const merge = (a, b, seat) => ({
    seat,
    cells: a.cells.map((c, i) => ({
      tricks: c.tricks,
      isContract: c.isContract || b.cells[i].isContract,
      isPar: c.isPar || b.cells[i].isPar,
    })),
  })
  const out = []
  for (const [x, y] of [
    ['N', 'S'],
    ['E', 'W'],
  ]) {
    if (same(bySeat[x], bySeat[y])) out.push(merge(bySeat[x], bySeat[y], x + y))
    else for (const s of [x, y]) if (bySeat[s]) out.push(bySeat[s])
  }
  return out
}

/** Tricks the contract needs, for reading a cell as made or beaten. */
export function contractTarget(contract) {
  const m = /^([1-7])/.exec(String(contract ?? '').trim())
  return m ? Number(m[1]) + 6 : null
}

const SEAT_LABELS = {
  N: 'North',
  S: 'South',
  E: 'East',
  W: 'West',
  NS: 'North and South',
  EW: 'East and West',
}

/** A cell's tooltip, as the classroom writes it, plus whether it is par. */
export function cellTitle(seat, strainIdx, cell, contract = '') {
  const who = SEAT_LABELS[seat] ?? seat
  const strain = DISPLAY_STRAINS[strainIdx]
  const what =
    strain === 'NT' ? 'notrump' : { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' }[strain]
  let text = `${who} ${seat.length > 1 ? 'take' : 'takes'} ${cell.tricks} tricks in ${what}`
  const target = contractTarget(contract)
  if (cell.isContract && target !== null) {
    const diff = cell.tricks - target
    text +=
      diff === 0
        ? ` — exactly makes ${contract}`
        : diff > 0
          ? ` — makes ${contract} with ${diff} over`
          : ` — ${contract} is down ${-diff} on best play`
  }
  if (cell.isPar) text += ' — par'
  return text
}
