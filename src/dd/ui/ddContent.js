// Bridge Craftwork DD's content script, on BBO's v3 client. Starts the
// double-dummy overlay (bboDdOverlay.js) and the deal-menu switch that shows or
// hides it (ddMenu.js). On by default; the choice is kept in extension storage,
// so it holds across tabs and visits.

import { startDdOverlay, POPOUT_ID, RESTART_ID } from './bboDdOverlay.js'
import { syncToggleItem, findDealMenu, ENABLED_KEY, TOGGLE_ITEM_ID } from './ddMenu.js'

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
      storage,
    })

    let enabled = (await storage.get(ENABLED_KEY))[ENABLED_KEY] !== false
    overlay.setEnabled(enabled)

    // When the extension is updated or reloaded, this script keeps running in
    // any BBO tab already open, cut off from the extension: every call to it
    // throws "Extension context invalidated". Rather than leave a menu item
    // that does nothing and marks that no longer update, it takes itself down
    // the first time it notices. Reloading the page brings the new one.
    const alive = () => !!globalThis.chrome?.runtime?.id
    let observer = null
    function retire() {
      observer?.disconnect()
      document.removeEventListener('click', onClick, true)
      overlay.setEnabled(false)
      document.getElementById(TOGGLE_ITEM_ID)?.remove()
    }

    const toggle = () => {
      if (!alive()) return retire()
      storage.set({ [ENABLED_KEY]: !enabled }).catch(retire)
    }
    storage.onChanged.addListener((changes) => {
      if (!(ENABLED_KEY in changes)) return
      enabled = changes[ENABLED_KEY].newValue !== false
      overlay.setEnabled(enabled)
      syncToggleItem(document, enabled, toggle)
    })

    const sync = () => {
      if (!alive()) return retire()
      syncToggleItem(document, enabled, toggle)
      // Our buttons sit in a higher stacking layer than BBO's deal menu, so
      // while it is open they would cover its rows. Step aside until it closes.
      const menuOpen = !!findDealMenu(document)
      for (const id of [POPOUT_ID, RESTART_ID]) {
        const btn = document.getElementById(id)
        if (btn) btn.style.visibility = menuOpen ? 'hidden' : ''
      }
    }
    observer = new MutationObserver(() => {
      sync()
      overlay.render()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    // BBO opens its deal menu by restyling it, not by adding anything, so the
    // observer above never sees it open. Watching style changes would fire on
    // every frame of BBO's card animations; a click is what opens the menu, so
    // re-check just after each one instead.
    function onClick() {
      setTimeout(sync, 0)
      setTimeout(sync, 250)
    }
    document.addEventListener('click', onClick, true)
    overlay.render()
  })
}
