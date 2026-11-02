// Bridge Craftwork DD's background. Double-dummy review in BBO's History panel:
// solves each board's play in bridge-solver's WASM, caches it, and registers
// the page hook that passes BBO's own History responses to the content script
// (src/ui/ddContent.js). Also carries the one hand-off the overlay's
// "Classroom" button needs, reusing Fetch's code for it.
//
// Nothing here fetches from BBO: the one thing that does is DD-all, in the
// content script, when the user asks. See docs/data-sources.md § 3.9.

import browser from 'webextension-polyfill'
import { createDdSolver } from './background/ddSolver.js'
import { handleMessage, sweepExpired } from './background/handlers.js'
import initSolver, { Analyzer } from './vendor/solver-wasm/bridge_solver_wasm.js'
import solverWasmUrl from './vendor/solver-wasm/bridge_solver_wasm_bg.wasm?url'

// The loaded solver is a cache, not state: lose it with the worker and the next
// board loads it again. Results live in storage.local.
const ddSolver = createDdSolver({
  loadSolver: async () => {
    await initSolver({ module_or_path: browser.runtime.getURL(solverWasmUrl.replace(/^\//, '')) })
    return { Analyzer }
  },
  storage: browser.storage.local,
})

// The page hook runs in BBO's own page, which a manifest content script can only
// reach through crxjs's loader — a dynamic import() of an extension URL, made
// from the page and so subject to BBO's CSP (`script-src *` admits no extension
// scheme). Registered here instead, the browser injects the file directly.
// Re-registered on every start: cheap, and it keeps the registration in step
// with the installed version.
const BBO_PAGE_HOOK = {
  id: 'bbo-page-hook',
  matches: ['https://www.bridgebase.com/v3/*'],
  js: ['bbo-page-hook.js'],
  runAt: 'document_start',
  world: 'MAIN',
}

async function registerBboPageHook() {
  const scripting = browser.scripting ?? globalThis.chrome?.scripting
  if (!scripting?.registerContentScripts) return
  const existing = await scripting.getRegisteredContentScripts({ ids: [BBO_PAGE_HOOK.id] })
  if (existing.length) await scripting.updateContentScripts([BBO_PAGE_HOOK])
  else await scripting.registerContentScripts([BBO_PAGE_HOOK])
}
registerBboPageHook().catch((err) =>
  console.warn('[bc] BBO page hook not registered:', err?.message ?? err)
)

// The "Classroom" button sends one deal, as a hand viewer URL, through the same
// path Fetch uses; the ingest page then collects it. Only those two messages
// are accepted — this extension reads nothing else.
const HANDOFF = new Set(['extract-session', 'consume-pending-session'])
const handoffDeps = () => ({
  storage: browser.storage.local,
  tabs: browser.tabs,
  crypto: globalThis.crypto,
  fetch: globalThis.fetch.bind(globalThis),
})

const reply = (promise, sendResponse, type) => {
  promise
    .then((value) => sendResponse(type ? { type, ...value } : value))
    .catch((err) => sendResponse({ type: 'dd-error', error: err?.message ?? String(err) }))
  return true
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'dd-trace':
      return reply(
        ddSolver.trace(message.resultkey, message.lin, message.place).then((entry) => ({ entry })),
        sendResponse,
        'dd-trace'
      )
    case 'dd-node':
      return reply(
        ddSolver.alternatives(message.lin, message.node).then((node) => ({ node })),
        sendResponse,
        'dd-node'
      )
    case 'dd-event':
      return reply(ddSolver.event(message.tkey, message.boards), sendResponse, 'dd-event')
    case 'dd-tallies':
      return reply(
        ddSolver.tallies(message.tkeys).then((tallies) => ({ tallies })),
        sendResponse,
        'dd-tallies'
      )
    case 'dd-lookup':
      return reply(
        ddSolver.lookup(message.resultkeys).then((entries) => ({ entries })),
        sendResponse,
        'dd-lookup'
      )
    default:
      if (!HANDOFF.has(message?.type)) return false
      return reply(handleMessage(message, handoffDeps()), sendResponse)
  }
})

// Pending hand-offs expire; sweep stale ones as Fetch does.
browser.runtime.onStartup?.addListener?.(() => {
  sweepExpired({ storage: browser.storage.local }).catch(() => {})
})
browser.runtime.onInstalled.addListener(() => {
  sweepExpired({ storage: browser.storage.local }).catch(() => {})
})
