// Bridge Craftwork DD's content script, on BBO's v3 client. Starts the
// double-dummy overlay (bboDdOverlay.js) and the deal-menu switch that shows or
// hides it (ddMenu.js). On by default; the choice is kept in extension storage,
// so it holds across tabs and visits.

import { startDdOverlay } from './bboDdOverlay.js'
import { syncToggleItem, ENABLED_KEY } from './ddMenu.js'

function showToast(text) {
  const el = document.createElement('div')
  el.textContent = text
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: '2147483647',
    background: '#333',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '4px',
    font: '14px sans-serif',
    maxWidth: '320px',
    boxShadow: '0 2px 8px rgba(0,0,0,.3)',
  })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 6000)
}

if (typeof globalThis.chrome !== 'undefined' || typeof globalThis.browser !== 'undefined') {
  import('webextension-polyfill').then(async ({ default: browser }) => {
    const storage = browser.storage.local
    const overlay = startDdOverlay({
      sendMessage: (msg) => browser.runtime.sendMessage(msg),
      onError: (text) => showToast(`Bridge Craftwork DD: ${text}`),
      onNotice: (text) => showToast(text),
    })

    let enabled = (await storage.get(ENABLED_KEY))[ENABLED_KEY] !== false
    overlay.setEnabled(enabled)

    const toggle = () => storage.set({ [ENABLED_KEY]: !enabled })
    storage.onChanged.addListener((changes) => {
      if (!(ENABLED_KEY in changes)) return
      enabled = changes[ENABLED_KEY].newValue !== false
      overlay.setEnabled(enabled)
      syncToggleItem(document, enabled, toggle)
    })

    const sync = () => syncToggleItem(document, enabled, toggle)
    new MutationObserver(() => {
      sync()
      overlay.render()
    }).observe(document.body, { childList: true, subtree: true })
    // BBO opens its deal menu by restyling it, not by adding anything, so the
    // observer above never sees it open. Watching style changes would fire on
    // every frame of BBO's card animations; a click is what opens the menu, so
    // re-check just after each one instead.
    document.addEventListener(
      'click',
      () => {
        setTimeout(sync, 0)
        setTimeout(sync, 250)
      },
      true
    )
    overlay.render()
  })
}
