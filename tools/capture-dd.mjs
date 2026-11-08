// Store screenshots for Bridge Craftwork DD, from the live BBO v3 client.
//
//   PROFILE=<copy of a signed-in Chromium profile> \
//   CHROMIUM=<path to a Chromium binary> \
//   node tools/capture-dd.mjs [event] [out-dir]
//
// Defaults: event "#33879", out-dir store/dd/screenshots. Loads dist/dd-chrome,
// so run `npm run build:dd` first.
//
// Use a COPY of the profile, never the one in use: BBO allows one session per
// account. The profile must have BBO's own `invisible` localStorage flag set
// ("y") so friends aren't told you came online; the script refuses otherwise.
//
// Players' names in the deal are blurred before each shot, the same as
// Fetch's BBO screenshots.
//
// 1280x800 at device scale 2, so 2560x1600: one set for Chrome, Edge, Firefox
// and the Mac App Store, as with Fetch.

import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const EVENT = process.argv[2] ?? '#33879'
const OUT = process.argv[3] ?? 'store/dd/screenshots'
const PROFILE = process.env.PROFILE
const CHROMIUM = process.env.CHROMIUM
const EXT = path.resolve('dist/dd-chrome')
if (!PROFILE) throw new Error('PROFILE must point at a copy of a signed-in Chromium profile')

fs.mkdirSync(OUT, { recursive: true })
const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...(CHROMIUM ? { executablePath: CHROMIUM } : { channel: 'chromium' }),
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept().catch(() => {}))

await page.goto('https://www.bridgebase.com/myhands/index.php')
await page.waitForLoadState('networkidle').catch(() => {})
if ((await page.evaluate(() => localStorage.getItem('invisible'))) !== 'y') {
  throw new Error('BBO invisible flag not set in this profile; refusing to sign in visibly')
}
// Give the History panel most of the frame. BBO keeps the panel's width
// ("<user>_hDividePixels") in localStorage and reads it at startup; this is a copy of the
// profile, so changing it touches nothing real. DIVIDER overrides.
const user = await page.evaluate(() =>
  Object.keys(localStorage)
    .find((k) => k.endsWith('_hDividePixels'))
    ?.replace(/_hDividePixels$/, '')
)
if (user) {
  await page.evaluate(
    ([u, px]) => localStorage.setItem(`${u}_hDividePixels`, px),
    [user, process.env.DIVIDER ?? '900']
  )
}
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
// Every player's name in the deal, the account's own included: it is in the
// top bar already, and a blurred row of four reads as deliberate.
async function blurNames() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.nameDisplayClass')) el.style.filter = 'blur(6px)'
  })
}
async function shot(name) {
  await blurNames()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log('wrote', path.join(OUT, `${name}.png`))
}

// The list of tournaments, part-way through a run, so one shot has complete events,
// an incomplete one marked *, and events not yet started. TALLY_MS sets how far it
// gets, at a second a request.
await page.locator('.bc-dd-history-header').filter({ visible: true }).click()
await page.waitForTimeout(400)
await page.locator('#bridge-craftwork-dd-menu button', { hasText: 'Everything listed' }).click()
await page.waitForTimeout(Number(process.env.TALLY_MS ?? 75000))
await page.locator('.bc-dd-history-header').filter({ visible: true }).click()
await page.waitForTimeout(2500)
await page.mouse.move(5, 5)
// BBO announces live vugraphs in a box over this corner, for several seconds.
await page
  .getByText(/vugraph broadcast has just started/i)
  .waitFor({ state: 'hidden', timeout: 30000 })
  .catch(() => console.log('a BBO announcement is still showing: check dd-4-tallies'))
await page.waitForTimeout(1000)
await shot('dd-4-tallies')

await page
  .locator('historic-tournament-list-item', { hasText: EVENT })
  .filter({ visible: true })
  .first()
  .click()
await page.waitForTimeout(5000)

// Open each board once so the list's tags and totals cover the whole event,
// then come back to board 1.
const rows = page.locator('result-list-item').filter({ visible: true })
const n = await rows.count()
for (let i = 1; i < n; i++) {
  await rows.nth(i).click()
  await page.waitForTimeout(1200)
}
await rows.nth(0).click()
await page.waitForTimeout(2500)

// 1. The event: board tags, totals, and board 1's error cards.
await page
  .locator('result-list')
  .filter({ visible: true })
  .first()
  .evaluate((el) => {
    el.querySelector('.listClass, .everythingClass')?.scrollTo?.(0, 0)
  })
await shot('dd-1-event')

// 2. The deal menu with its Show/Hide item, at the start of play, where it
//    has BBO's usual rows.
await page.evaluate(() =>
  [...document.querySelectorAll('.moreClass')].find((e) => e.getClientRects().length).click()
)
await page.waitForTimeout(800)
await shot('dd-2-menu')
await page.evaluate(() =>
  [...document.querySelectorAll('.moreClass')].find((e) => e.getClientRects().length).click()
)

// 3. An error's trick: click the first error card after trick 1 and wait for
//    the viewer to get there.
const target = await page.evaluate(() => {
  const viewer = [...document.querySelectorAll('deal-viewer')].find(
    (v) => v.getClientRects().length
  )
  const cards = [...viewer.querySelectorAll('[data-bc-dd]')]
  const pick = cards.find((c) => Number.parseInt(c.dataset.bcDd, 10) > 1) ?? cards[0]
  pick?.click()
  return pick ? Number.parseInt(pick.dataset.bcDd, 10) : null
})
if (target) {
  const want = 52 - 4 * target
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    const left = await page.evaluate(() => {
      const viewer = [...document.querySelectorAll('deal-viewer')].find(
        (v) => v.getClientRects().length
      )
      return [...viewer.querySelectorAll('hand-diagram-panel')]
        .filter((p) => p.getClientRects().length)
        .reduce((k, p) => k + p.querySelectorAll('hand-diagram-card').length, 0)
    })
    if (left === want) break
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(1500)
  await shot('dd-3-trick')
}

await page.goto('about:blank')
await ctx.close()
