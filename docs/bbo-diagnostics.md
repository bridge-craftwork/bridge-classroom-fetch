# BBO page-hook diagnostics

Instruments that were built into `public-dd/bbo-page-hook.js` on 6 Nov 2026 to find
where My Table's boards come from during a live event, and removed on 8 Nov 2026
once they had answered that (see `data-sources.md` § 3.9). They are kept here so a
later investigation can paste them back in rather than rebuild them.

The last commit that still had them is `fc0ca5b`:

```bash
git show fc0ca5b:public-dd/bbo-page-hook.js
```

## What they answered

- **Which servers BBO talks to.** `http` showed My Table's daylong boards arrive
  from `webutil.bridgebase.com/v2/ard.php`, while a pairs event's come over the
  game connection instead.
- **What the game connection carries.** `types` and `tags` showed BBO's WebSocket
  sends XML messages, mostly as `ArrayBuffer`s, and named the ones that matter:
  `sc_board_details` for a board opened in My Table, `sc_loginok` for who is
  signed in.
- **What a message looks like.** `__bcLive` held whole `sc_board_details` messages,
  which is how their layout (and the space in `</sc_board_details >`) was learned.

## Privacy, if they go back in

They were written to count shapes, never contents: `http` keeps host and path
without the query, `tags` keeps a message's outer tag name, and `shapeOf` keeps a
JSON message's field names and only the value of type-like fields. `__bcLive` is
the exception: it holds whole messages, including player names. It must not ship.
Nothing here is sent anywhere; all of it sits in page globals until read from the
console.

## Reading them

In the BBO tab's console (the page's own context, not the extension's):

```js
copy(JSON.stringify(window.__bcLiveSeen, null, 1)) // counts: http, sockets, types, tags
copy(window.__bcLive.join('\n\n'))                  // whole captured messages
```

## The code

Each piece below names where it went in the hook.

### HTTP requests by host and path

After `kindOf`:

```js
// TEMPORARY: requests counted by server and path, no query.
function noteHttp(url) {
  try {
    const u = new URL(url)
    const seen = (window.__bcLiveSeen ??= { installed: Date.now(), types: {}, tags: {} })
    const key = u.host + u.pathname
    seen.http = seen.http ?? {}
    seen.http[key] = (seen.http[key] ?? 0) + 1
  } catch {
    // Diagnostic only.
  }
}
```

Called first thing in `xhr.send`, as `noteHttp(this.__bcUrl)`, and in the `fetch`
wrapper after `url` is known, as `noteHttp(url && new URL(url, window.location.href).href)`.

### Frame types and message tags

Before `function frame`:

```js
// TEMPORARY: what kinds of frames arrive and the name of each message's outer
// tag, counted, never its contents.
const seen = (window.__bcLiveSeen ??= { installed: Date.now(), types: {}, tags: {} })
// A JSON message by its field names and the value of any type-like field,
// never other values; anything else by its first few characters' shape.
const KIND_FIELDS = ['type', 'event', 'cmd', 'command', 'action', 'op', 't', 'name', 'msg_type']
function shapeOf(text) {
  if (!text) return null
  if (text[0] === '{' || text[0] === '[') {
    try {
      const v = JSON.parse(text)
      const o = Array.isArray(v) ? (typeof v[0] === 'object' && v[0] ? v[0] : { '[array]': 1 }) : v
      const keys = Object.keys(o ?? {})
        .sort()
        .slice(0, 12)
        .join(',')
      const kind = KIND_FIELDS.map((k) =>
        typeof o?.[k] === 'string' && o[k].length <= 40 ? `${k}=${o[k]}` : null
      )
        .filter(Boolean)
        .join(' ')
      const big = text.length > 2000 ? ' BIG' : ''
      return `json{${keys}}${kind ? ' ' + kind : ''}${big}`
    } catch {
      return `(json? ${text.length} chars)`
    }
  }
  return `(${text.slice(0, 6).replace(/[^<?!\w]/g, '.')}… ${text.length} chars)`
}
```

First lines of `frame(data, state)`:

```js
const type = typeof data === 'string' ? 'string' : (data?.constructor?.name ?? typeof data)
seen.types[type] = (seen.types[type] ?? 0) + 1
```

First lines inside the `for (const part of data.split('\0'))` loop in `tap`, after
`if (!part) continue`:

```js
const tag = /^\s*<([\w:.-]{1,40})/.exec(part)?.[1] ?? shapeOf(part.trim())
if (tag) seen.tags[tag] = (seen.tags[tag] ?? 0) + 1
```

### Sockets by host

In the `WebSocket` subclass's constructor, after `super(...args)`:

```js
try {
  const host = new URL(String(args[0])).host
  seen.sockets = seen.sockets ?? {}
  seen.sockets[host] = (seen.sockets[host] ?? 0) + 1
} catch {
  // Diagnostic only.
}
```

### Whole captured messages

At the end of `finish(state)`, which then needs `done` back in its destructuring
(`const { kind, body, done } = state.collecting`):

```js
// TEMPORARY: kept where `copy(__bcLive)` in the console can reach them.
// Holds whole messages, names included. Never ship.
;(window.__bcLive ??= []).push(done ? body : `${body}  [INCOMPLETE]`)
```

To capture another message type, add it to `LIVE` with its opening and closing
tag patterns; `finish` sees everything `LIVE` collects.
