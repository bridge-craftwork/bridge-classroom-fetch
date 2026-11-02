// The reviewer demo for Bridge Craftwork DD, recorded from the live BBO client.
//
//   PROFILE=<copy of a signed-in Chromium profile> \
//   CHROMIUM=<path to a Chromium binary> \
//   node tools/record-dd-demo.mjs [event] [out.mp4]
//
// Defaults: event "#33879", out demo/dd/bridge-craftwork-dd.mp4. Loads
// dist/dd-chrome, so run `npm run build:dd` first; needs ffmpeg.
//
// Reviewers can't reach this feature themselves: it needs a BBO account with
// played history, and BBO allows one session per account. So this shows it all,
// with real mouse clicks. A headless recording has no pointer, so one is drawn,
// and captions sit over the lobby, which the feature doesn't use.
//
// Use a COPY of the profile, never the one in use. The script refuses unless
// BBO's own `invisible` flag is set. Players' names are blurred throughout, on
// BBO and on the Bridge Classroom page DD Details opens.

import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EVENT = process.argv[2] ?? '#33879'
const OUT = process.argv[3] ?? 'demo/dd/bridge-craftwork-dd.mp4'
const PROFILE = process.env.PROFILE
const CHROMIUM = process.env.CHROMIUM
const EXT = path.resolve('dist/dd-chrome')
if (!PROFILE) throw new Error('PROFILE must point at a copy of a signed-in Chromium profile')

const SIZE = { width: 1280, height: 800 }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-demo-'))
const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...(CHROMIUM ? { executablePath: CHROMIUM } : { channel: 'chromium' }),
  headless: true,
  viewport: SIZE,
  recordVideo: { dir: work, size: SIZE },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const page = await ctx.newPage()
const pageBorn = Date.now()
page.on('dialog', (d) => d.accept().catch(() => {}))

// Every player's username, from the LINs BBO loads (pn|S,W,N,E|), so they can be
// scrubbed from the page DD Details opens.
const names = new Set()
page.on('response', async (r) => {
  if (!/mh_hand\.php/.test(r.url())) return
  const pn = /pn\|([^|]*)\|/.exec(await r.text().catch(() => ''))
  for (const n of pn?.[1].split(',') ?? []) if (n.trim()) names.add(n.trim())
})

// ── Setup, trimmed from the recording ───────────────────────────────────────
await page.goto('https://www.bridgebase.com/myhands/index.php')
await page.waitForLoadState('networkidle').catch(() => {})
if ((await page.evaluate(() => localStorage.getItem('invisible'))) !== 'y') {
  throw new Error('BBO invisible flag not set in this profile; refusing to sign in visibly')
}
// Give the History panel most of the frame, as tools/capture-dd.mjs does.
await page.evaluate(() => {
  const k = Object.keys(localStorage).find((key) => key.endsWith('_hDividePixels'))
  if (k) localStorage.setItem(k, '900')
})
await page.goto('https://www.bridgebase.com/v3/')
await page.waitForTimeout(8000)

const visible = async (sel) => page.locator(sel).filter({ visible: true }).count()
if (!(await visible('historic-tournament-list')) && !(await visible('result-list-item'))) {
  await page.locator('.area-label:text-is("History")').click()
  await page.waitForTimeout(1500)
}
if (await visible('result-list-item')) {
  await page.locator('title-bar').filter({ visible: true }).locator('svg-icon').first().click()
  await page.waitForTimeout(1500)
}
if (!(await visible('historic-tournament-list'))) {
  await page.locator('.mdc-tab__text-label:text-is("Recent tournaments")').click()
  await page.waitForTimeout(1500)
}

async function dress(target, { captionBox }) {
  await target.evaluate((captionBox) => {
    const style = document.createElement('style')
    style.textContent = `
      .nameDisplayClass { filter: blur(6px) }
      #demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; left: 0; top: 0;
        pointer-events: none; transition: transform 40ms linear; }
      #demo-caption { position: fixed; z-index: 2147483646; pointer-events: none;
        left: ${captionBox.left}px; top: ${captionBox.top}px; width: ${captionBox.width}px;
        padding: 16px 20px; border-radius: 10px; background: rgba(17, 24, 54, 0.94); color: #fff;
        font: 500 21px/1.4 -apple-system, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35) }
      #demo-caption:empty { display: none }
      .demo-click { position: fixed; z-index: 2147483646; width: 34px; height: 34px; border-radius: 50%;
        border: 3px solid #e8590c; pointer-events: none; animation: demo-click .55s ease-out forwards }
      @keyframes demo-click { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`
    document.head.appendChild(style)
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 14 L19 14 Z" fill="#fff" stroke="#000" stroke-width="1.6"/></svg>'
    document.documentElement.appendChild(cursor)
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    document.documentElement.appendChild(caption)
    addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    }, true)
    addEventListener('mousedown', (e) => {
      const ring = document.createElement('div')
      ring.className = 'demo-click'
      ring.style.left = `${e.clientX - 17}px`
      ring.style.top = `${e.clientY - 17}px`
      document.documentElement.appendChild(ring)
      setTimeout(() => ring.remove(), 600)
    }, true)
  }, captionBox)
}
const LOBBY_CAPTION = { left: 28, top: 200, width: 500 }
await dress(page, { captionBox: LOBBY_CAPTION })

const say = (text, target = page) =>
  target.evaluate((t) => {
    document.getElementById('demo-caption').textContent = t
  }, text)

// The centre of the first match the function finds, or null.
const centre = (fn, arg) =>
  page.evaluate(
    ([src, a]) => {
      const el = new Function('a', `return (${src})(a)`)(a)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    },
    [fn.toString(), arg]
  )
async function clickAt(pt, target = page) {
  await target.mouse.move(pt.x, pt.y, { steps: 22 })
  await target.waitForTimeout(350)
  await target.mouse.down()
  await target.mouse.up()
}
const rowCentre = (i) =>
  centre((n) => [...document.querySelectorAll('result-list-item')].filter((e) => e.getClientRects().length)[n], i)
const errorCard = (trick) =>
  centre(
    (t) => {
      const v = [...document.querySelectorAll('deal-viewer')].find((e) => e.querySelector('[data-bc-dd]') && e.getClientRects().length)
      return [...(v?.querySelectorAll('[data-bc-dd]') ?? [])].find((c) => c.dataset.bcDd.startsWith(`${t}:`))
    },
    trick
  )
const hamburger = () =>
  centre(() => [...document.querySelectorAll('.moreClass')].find((e) => e.getClientRects().length))
const byId = (id) => centre((i) => document.getElementById(i), id)
const cardsLeft = () =>
  page.evaluate(() => {
    const v = [...document.querySelectorAll('deal-viewer')].find((e) => e.getClientRects().length)
    return [...v.querySelectorAll('hand-diagram-panel')]
      .filter((p) => p.getClientRects().length)
      .reduce((k, p) => k + p.querySelectorAll('hand-diagram-card').length, 0)
  })
async function untilCards(n) {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000 && (await cardsLeft()) !== n) await page.waitForTimeout(80)
}

// ── The demo ────────────────────────────────────────────────────────────────
const start = Date.now() - pageBorn
await page.mouse.move(640, 400)

await say("Bridge Base Online's History panel. Bridge Craftwork DD adds a double-dummy review to it. Opening an event…")
await page.waitForTimeout(3000)
const eventPt = await centre(
  (ev) => [...document.querySelectorAll('historic-tournament-list-item')].find((e) => e.getClientRects().length && e.textContent.includes(ev)),
  EVENT
)
await clickAt(eventPt)
await page.waitForTimeout(3000)

await say('Each board you open is analysed on your device. Its row is tagged with the errors by you, your partner and the opponents, and the totals sit beside BBO’s score.')
await page.waitForTimeout(4500)
for (const i of [1, 2]) {
  await clickAt(await rowCentre(i))
  await page.waitForTimeout(2200)
}
await say('A board with no errors says “clean”, so it can be told from one not yet opened.')
await page.waitForTimeout(3500)
await clickAt(await rowCentre(0))
await page.waitForTimeout(2200)

await say('In the hands, each card that cost a trick is marked with the trick it went to. Clicking one goes to that trick.')
await page.waitForTimeout(4500)
await clickAt(await errorCard(3))
await untilCards(40)
await page.waitForTimeout(800)

await say('On the table: the card that led (blue), the winner (green), the error (pink). In the hand that erred, what should have been played: best cards green, the rest red.')
await page.waitForTimeout(7000)

await say('The next error is one click further on.')
await page.waitForTimeout(2000)
await clickAt(await errorCard(4))
await untilCards(36)
await page.waitForTimeout(3500)

await say('Restart goes back to the start of the play.')
await page.waitForTimeout(2000)
await clickAt(await byId('bridge-classroom-dd-restart'))
await untilCards(52)
await page.waitForTimeout(2500)

await say('It can be hidden from the menu on the board, which removes everything it draws…')
await page.waitForTimeout(2500)
await clickAt(await hamburger())
await page.waitForTimeout(1800)
await clickAt(await byId('bridge-craftwork-dd-toggle'))
await page.waitForTimeout(3500)
await say('…and shown again.')
await clickAt(await hamburger())
await page.waitForTimeout(1500)
await clickAt(await byId('bridge-craftwork-dd-toggle'))
await page.waitForTimeout(3000)

await say('DD Details sends this one board to Bridge Classroom, the only time anything leaves the device.')
await page.waitForTimeout(4000)
// Scrub the names from every page from here on, before any of it is drawn: the
// new tab's recording starts as it opens, so anything shown even briefly would
// be in the video. Robots' internal names (~~M29864) go too.
await ctx.addInitScript((list) => {
  const pattern = new RegExp(
    [...list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '~~\\w+'].join('|'),
    'g'
  )
  const scrub = (root) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const after = n.nodeValue.replace(pattern, 'player')
      if (after !== n.nodeValue) n.nodeValue = after
    }
  }
  new MutationObserver(() => document.documentElement && scrub(document.documentElement)).observe(
    document,
    { childList: true, subtree: true, characterData: true }
  )
}, [...names])
const opened = ctx.waitForEvent('page', { timeout: 15000 })
await clickAt(await byId('bridge-classroom-dd-popout'))
const p2 = await opened
const p2Born = Date.now()
const chain = []
p2.on('framenavigated', (f) => {
  if (f === p2.mainFrame()) chain.push(f.url().replace(/[#?].*/, ''))
})
await page.waitForTimeout(800)
const mainEnd = Date.now() - pageBorn

// The hand-off passes through Bridge Classroom's ingest page on its way to the
// detailed view; wait for it to land before captioning.
await p2.waitForURL(/bridge-solver/, { timeout: 15000 }).catch(() => {})
await p2.waitForLoadState('networkidle').catch(() => {})
await p2.waitForTimeout(1500)
console.log('hand-off chain:', chain.join(' -> '))
await dress(p2, { captionBox: { left: 740, top: 150, width: 500 } })
await say('The board in the detailed double-dummy view: every error, and what each alternative was worth.', p2)
await p2.waitForTimeout(6000)
const p2End = Date.now() - p2Born

// ── Encode ──────────────────────────────────────────────────────────────────
const v1 = page.video()
const v2 = p2.video()
await p2.close()
await page.goto('about:blank').catch(() => {})
await page.close()
await ctx.close()
const f1 = await v1.path()
const f2 = await v2.path()

const seconds = (ms) => (ms / 1000).toFixed(2)
const enc = ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '30', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-r', '15']
fs.mkdirSync(path.dirname(OUT), { recursive: true })
const a = path.join(work, 'a.mp4')
const b = path.join(work, 'b.mp4')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', seconds(start), '-to', seconds(mainEnd), '-i', f1, ...enc, a])
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-to', seconds(p2End), '-i', f2, ...enc, b])
const list = path.join(work, 'list.txt')
fs.writeFileSync(list, `file '${a}'\nfile '${b}'\n`)
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT])
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes')
