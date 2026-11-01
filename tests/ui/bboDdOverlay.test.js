import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  readPanel,
  matchPanels,
  drawDeal,
  clearDeal,
  drawIndex,
  drawTotals,
  drawTable,
  cardsInHands,
  stepToTrick,
  chipFor,
  syncPopout,
  rankOf,
  POPOUT_ID,
} from '../../src/ui/bboDdOverlay.js'
import { parseMhList, parseMhHand } from '../../src/adapters/bbo/parsers/mhXml.js'
import { parseLin } from '../../src/adapters/bbo/parsers/lin.js'
import { summarizeTrace } from '../../src/lib/ddPlay.js'

const fx = (name) => readFileSync(join(import.meta.dirname, '../../fixtures/bbo', name), 'utf8')

// The History panel's markup, captured from the live v3 client with board 1 of
// #33873 open. It holds two deal viewers: the visible one, and BBO's hidden
// "My Table" copy with empty hands. jsdom does no layout, so visibility is
// decided here by whether a viewer holds any cards.
const visible = (el) => {
  const viewer = el.closest('deal-viewer') ?? el.querySelector?.('deal-viewer')
  return !viewer || viewer.querySelector('hand-diagram-card') !== null
}

const board1 = parseMhHand(fx('mh-hand-33873-board1.xml'))
const deal1 = parseLin(board1.lin).deal
const list = parseMhList(fx('mh-list-33873-kemistry.xml'))

// The solver's actual answer for board 1 (see tests/background/ddSolver.test.js),
// trimmed to what drawing needs.
const plays = [...board1.lin.matchAll(/pc\|(\w\w)/g)].map((m) => m[1])
const seats = ['W', 'N', 'E', 'S']
const entry1 = {
  contract: '3NT',
  declarer: 'S',
  players: { N: 'kemistry', E: 'missy2727', S: 'aam135', W: 'ARFBridge' },
  trace: plays.map((card, index) => ({ index, card, seat: '?', cost: card === 'SJ' ? 1 : 0 })),
}
entry1.trace[39].seat = 'W'

let doc
beforeEach(() => {
  doc = new DOMParser().parseFromString(
    `<body>${fx('v3-history-33873-board1.html')}</body>`,
    'text/html'
  )
})

describe('rankOf', () => {
  it("reads BBO's card faces", () => {
    expect(rankOf(' K\n')).toBe('K')
    expect(rankOf('10')).toBe('T')
    expect(rankOf('x')).toBeNull()
  })
})

describe('reading the hand diagram', () => {
  it('reads each panel by suit, matching rows to symbols', () => {
    const panel = [...doc.querySelectorAll('hand-diagram-panel')].find((p) =>
      p.querySelector('hand-diagram-card')
    )
    const codes = readPanel(panel).map((c) => c.code)
    expect(codes).toHaveLength(13)
    expect(codes).toContain('CK')
    expect(codes).toContain('HT')
  })

  it("ties every panel to its seat in board 1's deal", () => {
    const matched = matchPanels(doc, deal1, visible)
    expect(matched.hands.map((h) => h.seat).sort()).toEqual(['E', 'N', 'S', 'W'])
    expect(matched.hands.every((h) => h.cards.length === 13)).toBe(true)
  })

  it('refuses to draw on a different deal', () => {
    const board5 = parseLin(parseMhHand(fx('mh-hand-33873-board5.xml')).lin).deal
    expect(matchPanels(doc, board5, visible)).toBeNull()
  })
})

describe('drawing the deal', () => {
  it('numbers and marks only the error card, and does it only once', () => {
    const { hands } = matchPanels(doc, deal1, visible)
    const summary = summarizeTrace(entry1.trace, { declarer: 'S', mySeat: 'N' })
    drawDeal(hands, summary, doc)
    // Only the error is numbered.
    const badges = doc.querySelectorAll('.bc-dd-trick')
    expect(badges).toHaveLength(1)
    const sj = hands.flatMap((h) => h.cards).find((c) => c.code === 'SJ').el
    expect(sj.querySelector('.bc-dd-trick').textContent).toBe('10')
    expect(sj.title).toMatch(/cost 1 trick\. Click to go to the trick\.$/)
    expect(sj.style.backgroundColor).not.toBe('')

    // Redrawing changes nothing — what keeps the mutation observer quiet.
    const before = doc.body.innerHTML
    drawDeal(hands, summary, doc)
    expect(doc.body.innerHTML).toBe(before)

    // And the faces still read as cards once badged.
    expect(matchPanels(doc, deal1, visible)).not.toBeNull()

    clearDeal(doc)
    expect(doc.querySelectorAll('.bc-dd-trick')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-bc-dd]')).toHaveLength(0)
  })
})

describe('the board list', () => {
  it('chips a board with errors, from the user’s seat', () => {
    const entries = new Map([[list.boards[0].resultkey, entry1]])
    drawIndex(doc, list, entries, 'kemistry', visible)
    const chips = doc.querySelectorAll('.bc-dd-chip')
    expect(chips).toHaveLength(1)
    // kemistry was dummy; only the side that erred gets a line.
    const lines = [...chips[0].children].map((l) =>
      [...l.children].map((c) => c.textContent).join(' ')
    )
    expect(lines).toEqual(['opp 1'])
    // Centred on the visible 46px row, not the taller cell.
    expect(chips[0].style.top).toBe('23px')
    // Three lines filling the row: 14px lines, 13px type.
    expect(chips[0].style.fontSize).toBe('13px')
    expect(
      chips[0].closest('result-list-item').querySelector('.cellClass').textContent.trim()
    ).toBe('1')
  })

  it('tags a checked board with no errors as clean, so it reads differently from an unchecked one', () => {
    const none = { errors: 0, tricks: 0 }
    expect(chipFor({ me: none, partner: none, opps: none }, 0)).toMatchObject({ clean: true })
    expect(chipFor(null, 0)).toMatchObject({ clean: true })
    const doc2 = doc
    const clean = { ...entry1, trace: entry1.trace.map((t) => ({ ...t, cost: 0 })) }
    drawIndex(doc2, list, new Map([[list.boards[0].resultkey, clean]]), 'kemistry', visible)
    expect(doc2.querySelector('.bc-dd-chip').textContent).toBe('clean')
  })

  it('shows nothing for a board not yet analysed', () => {
    drawIndex(doc, list, new Map(), 'kemistry', visible)
    expect(doc.querySelectorAll('.bc-dd-chip')).toHaveLength(0)
  })
})

describe('the pop-out', () => {
  it('sits under BBO’s deal menu, once', () => {
    const { viewer } = matchPanels(doc, deal1, visible)
    let clicks = 0
    const btn = syncPopout(doc, viewer, () => clicks++)
    expect(syncPopout(doc, viewer, () => clicks++)).toBe(btn)
    expect(doc.querySelectorAll(`#${POPOUT_ID}`)).toHaveLength(1)
    expect(btn.style.top).toBe('52px')
    btn.click()
    expect(clicks).toBe(1)
    syncPopout(doc, null)
    expect(doc.getElementById(POPOUT_ID)).toBeNull()
  })
})

describe('event totals', () => {
  it("sit in the footer, left of BBO's own totals and in their size", () => {
    const clean = { ...entry1, trace: entry1.trace.map((t) => ({ ...t, cost: 0 })) }
    const entries = new Map([
      [list.boards[0].resultkey, entry1],
      [list.boards[1].resultkey, clean],
    ])
    drawTotals(doc, list, entries, 'kemistry', visible)
    const el = doc.querySelector('.bc-dd-totals')
    expect(el.textContent).toBe('DD errorsme 0pd 0opp 1')
    expect(el.style.fontSize).toBe('22px')
    expect(el.title).toMatch(/2 of 12 boards/)
    // In the same row as BBO's 60.2%.
    expect(el.parentElement.textContent).toContain('60.2%')

    drawTotals(doc, list, new Map(), 'kemistry', visible)
    expect(doc.querySelector('.bc-dd-totals')).toBeNull()
  })
})

// A stand-in for BBO's viewer, behaving as measured on #33879: Next trick
// animates its trick a card per tick; Previous trick goes back a whole trick
// at once and is disabled at the start. A press mid-animation is ignored here;
// stepToTrick never makes one.
function fakeViewer({ lastCard = 52, played: start = 0 } = {}) {
  let played = start
  let animatingTo = null
  const tick = () => {
    if (animatingTo != null && played < animatingTo) played++
    if (played === animatingTo) animatingTo = null
  }
  const prev = {
    clicks: 0,
    get disabled() {
      return played === 0 && animatingTo == null
    },
    click() {
      prev.clicks++
      animatingTo = null
      played = Math.max(0, Math.ceil(played / 4) * 4 - 4)
    },
  }
  const next = {
    clicks: 0,
    get disabled() {
      return played >= lastCard
    },
    click() {
      next.clicks++
      if (animatingTo != null) return
      animatingTo = Math.min(lastCard, (Math.floor(played / 4) + 1) * 4)
      tick()
    },
  }
  return {
    prev,
    next,
    cards: () => 52 - played,
    sleep: async () => tick(),
    get played() {
      return played
    },
  }
}

describe('stepToTrick', () => {
  it('goes forward from where the viewer is, one press per trick', async () => {
    const v = fakeViewer({ played: 8 })
    expect(await stepToTrick({ ...v, trick: 7 })).toBe(7)
    expect(v.played).toBe(28)
    expect(v.next.clicks).toBe(5)
    expect(v.prev.clicks).toBe(0)
  })

  it('goes back with Previous, without replaying from the start', async () => {
    const v = fakeViewer({ played: 40 })
    expect(await stepToTrick({ ...v, trick: 4 })).toBe(4)
    expect(v.played).toBe(16)
    expect(v.next.clicks).toBe(0)
  })

  it('lets a trick still animating land before counting from it', async () => {
    const v = fakeViewer({ played: 12 })
    v.next.click() // trick 4 under way
    expect(await stepToTrick({ ...v, trick: 6 })).toBe(6)
    expect(v.played).toBe(24)
  })

  it('stops where a claimed board stops', async () => {
    const v = fakeViewer({ lastCard: 18 }) // claimed during trick 5
    await stepToTrick({ ...v, trick: 9 })
    expect(v.played).toBe(18)
  })
})

describe('the trick on the table', () => {
  it('marks nothing before any card is played, though BBO keeps cards there', () => {
    const { viewer } = matchPanels(doc, deal1, visible)
    const summary = summarizeTrace(entry1.trace, { declarer: 'S', mySeat: 'N' })
    drawTable(viewer, summary, visible)
    expect(viewer.querySelectorAll('[data-bc-dd-table]')).toHaveLength(0)
  })

  it('counts the cards still in the hands', () => {
    const { viewer } = matchPanels(doc, deal1, visible)
    expect(cardsInHands(viewer, visible)).toBe(52)
  })
})
