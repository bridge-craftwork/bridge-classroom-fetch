// Runs in BBO's own page (world: MAIN), registered by the background with
// scripting.registerContentScripts. Not bundled: this file is copied as-is.
//
// BBO's History panel fetches the list of recent events (tfind.php), each event's
// board list (mh_list.php) and each board's LIN (mh_hand.php) as the user opens
// them. A content script cannot see the page's network traffic, so this passes a
// copy of those three responses to it with window.postMessage. It makes no requests of its own and changes
// nothing BBO receives: every call goes through untouched, and the copy is
// taken after the response has arrived.
//
// Everything else BBO requests is ignored. See docs/data-sources.md § 3.9.
//
// It also does one other thing, and only on request: while the extension steps
// BBO's viewer to an error's trick, it shortens BBO's animation delays so the
// jump takes a moment rather than two seconds a trick (see "Fast steps" below).
;(() => {
  if (window.__bridgeClassroomHook) return
  window.__bridgeClassroomHook = true

  const TAG = 'bridge-classroom-bbo'
  const WANTED = /^https:\/\/webutil\.bridgebase\.com\/v2\/(tfind|mh_list|mh_hand)\.php/
  const KINDS = { tfind: 'events', mh_list: 'list', mh_hand: 'hand' }
  const MAX_BODY = 256 * 1024
  const recent = []

  function pass(kind, url, requestBody, body) {
    if (typeof body !== 'string' || body.length > MAX_BODY) return
    const msg = {
      source: TAG,
      kind,
      url,
      requestBody: typeof requestBody === 'string' ? requestBody : null,
      body,
    }
    // Kept so a content script that starts late can ask for what it missed.
    recent.push(msg)
    if (recent.length > 30) recent.shift()
    window.postMessage(msg, window.location.origin)
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== TAG + ':replay') return
    for (const msg of recent) window.postMessage(msg, window.location.origin)
  })

  const kindOf = (url) => KINDS[WANTED.exec(String(url ?? ''))?.[1]] ?? null

  // ── Fast steps ──────────────────────────────────────────────────────────────
  //
  // BBO animates a trick as a chain of setTimeout(…, 750) calls, one per card,
  // then a 2-second pause (measured). Its own Animation setting would remove
  // them, but BBO reads that only at startup and changing it is the user's
  // business. So while the extension is stepping to a trick, and only then,
  // delays in that range are cut to 10 ms. Everything else is untouched, and
  // fast mode switches itself off after 15 seconds whatever happens, so a
  // stalled jump cannot leave BBO running fast.
  //
  // This script runs before BBO's code, so BBO's own timer wrapper (zone.js)
  // sits on top of this one and every BBO timer passes through it.
  const FAST_FOR_MS = 15000
  let fastUntil = 0
  const nativeSetTimeout = window.setTimeout
  window.setTimeout = function (fn, ms, ...args) {
    if (typeof ms === 'number' && ms >= 200 && ms <= 2000 && performance.now() < fastUntil) ms = 10
    return nativeSetTimeout.call(this, fn, ms, ...args)
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== TAG + ':fast') return
    fastUntil = e.data.on ? performance.now() + FAST_FOR_MS : 0
  })

  const xhr = XMLHttpRequest.prototype
  const open = xhr.open
  const send = xhr.send
  xhr.open = function (method, url) {
    try {
      this.__bcUrl = new URL(url, window.location.href).href
    } catch {
      this.__bcUrl = null
    }
    return open.apply(this, arguments)
  }
  xhr.send = function (body) {
    const kind = kindOf(this.__bcUrl)
    if (kind) {
      this.addEventListener('load', () => {
        try {
          if (this.status !== 200) return
          if (this.responseType !== '' && this.responseType !== 'text') return
          pass(kind, this.__bcUrl, body, this.responseText)
        } catch {
          // Never let our copy disturb BBO's request.
        }
      })
    }
    return send.apply(this, arguments)
  }

  const nativeFetch = window.fetch
  window.fetch = function (input, init) {
    const result = nativeFetch.apply(this, arguments)
    try {
      const url = typeof input === 'string' ? input : input?.url
      const kind = kindOf(url && new URL(url, window.location.href).href)
      if (kind) {
        result
          .then((r) => (r.ok ? r.clone().text() : null))
          .then((text) => text && pass(kind, url, init?.body, text))
          .catch(() => {})
      }
    } catch {
      // As above.
    }
    return result
  }
})()
