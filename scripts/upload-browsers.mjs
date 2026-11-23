#!/usr/bin/env node
// Upload a packaged build to addons.mozilla.org or Edge Add-ons, with its
// reviewer notes, through their APIs.
//
// USAGE
//   node scripts/upload-browsers.mjs fetch|dd firefox|edge|both [--submit] [--release-notes]
//
// Without --submit nothing reaches a reviewer:
//   firefox  the package goes through AMO's validator, and its result is shown
//   edge     the package becomes the product's draft in Partner Center
// With --submit:
//   firefox  a new listed version is created from it, with the reviewer notes
//            and the source archive: that is AMO's submission for review
//   edge     the draft is published with the reviewer notes ("notes for
//            certification"): that is Edge's submission for review
// --release-notes also sends the version's release notes to AMO (Edge's API
// has no field for them).
//
// Run scripts/package-stores.sh (EXT=dd for DD) first; this reads
// dist/packages/<name>-<version>-{firefox,edge,source}.zip.
//
// The Chrome Web Store is not here: its API cannot set the test instructions,
// which are pasted in the dashboard.
//
// Text: the reviewer notes are the fenced blocks in docs/submission-answers.md
// (Fetch) or store/dd/submission.md (DD), read at run time, so the copy in the
// docs is the copy sent.
//
// CREDENTIALS, from the login Keychain (synced from 1Password item "Browser
// Extension API Keys" by secrets-sync, family-computing/tools/secrets):
//   env/personal/AMO_JWT_ISSUER, AMO_JWT_SECRET, EDGE_CLIENT_ID, EDGE_API_KEY.
// Values never reach the terminal.

import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, openAsBlob, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Edge's product id is the GUID on the extension's Overview page in Partner
// Center, not the store id in the listing's URL. Not secret.
const APPS = {
  fetch: {
    name: 'bridge-classroom-fetch',
    manifest: 'manifest.json',
    guid: 'bridge-classroom-fetch@bridge-classroom.org',
    edgeProduct: null,
    doc: 'docs/submission-answers.md',
    notes: { heading: '## Notes for reviewers', block: 0 },
    amoExtra: { heading: '**For addons.mozilla.org, add**', block: 0 },
    releaseNotes: { heading: '## Release notes', block: 0 },
  },
  dd: {
    name: 'bridge-craftwork-dd',
    manifest: 'manifest.dd.json',
    guid: 'bridge-craftwork-dd@bridge-classroom.org',
    edgeProduct: 'e333c1ec-a2a4-488a-b3df-78d823995dd7', // store id 0RDCKF299KZ1
    doc: 'store/dd/submission.md',
    // The section's first block is Chrome's 500-character version.
    notes: { heading: '## Notes for reviewers', block: 1 },
    amoExtra: null,
    releaseNotes: { heading: '## Release notes', block: 0 },
  },
}

const [appKey, storeArg, ...flags] = process.argv.slice(2)
const app = APPS[appKey]
const stores = storeArg === 'both' ? ['firefox', 'edge'] : [storeArg]
const SUBMIT = flags.includes('--submit')
const RELEASE_NOTES = flags.includes('--release-notes')
const unknown = flags.filter((f) => !['--submit', '--release-notes'].includes(f))
if (!app || !stores.every((s) => s === 'firefox' || s === 'edge') || unknown.length) {
  console.error('usage: node scripts/upload-browsers.mjs fetch|dd firefox|edge|both [--submit] [--release-notes]')
  process.exit(2)
}

const version = JSON.parse(readFileSync(join(ROOT, app.manifest), 'utf8')).version
const pkg = (kind) => {
  const file = join(ROOT, 'dist/packages', `${app.name}-${version}-${kind}.zip`)
  if (!existsSync(file)) fail(`${basename(file)} is missing; run scripts/package-stores.sh`)
  return file
}

function fail(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function keychain(name) {
  try {
    return execFileSync('security', ['find-generic-password', '-a', process.env.USER, '-s', `env/personal/${name}`, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    fail(`Keychain item env/personal/${name} is missing; run secrets-sync`)
  }
}

/** The `block`th fenced block after the line starting with `heading`. */
function fenced(spec) {
  const text = readFileSync(join(ROOT, app.doc), 'utf8')
  const start = text.split('\n').findIndex((l) => l.startsWith(spec.heading))
  if (start < 0) fail(`${app.doc}: no "${spec.heading}"`)
  const rest = text.split('\n').slice(start + 1).join('\n')
  const blocks = [...rest.matchAll(/^```[^\n]*\n([\s\S]*?)\n```$/gm)].map((m) => m[1])
  if (!blocks[spec.block]) fail(`${app.doc}: no block ${spec.block} after "${spec.heading}"`)
  return blocks[spec.block].trim()
}

const notes = fenced(app.notes)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── addons.mozilla.org ──────────────────────────────────────────────────────

const AMO = 'https://addons.mozilla.org/api/v5'
const AMO_NOTES_MAX = 3000
const DEAL_REDIRECT = 'https://bridge-craftwork.github.io/bridge-classroom-fetch/demo/deal'
let amoCreds
function amoAuth() {
  amoCreds ??= { iss: keychain('AMO_JWT_ISSUER'), secret: keychain('AMO_JWT_SECRET') }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: amoCreds.iss, jti: randomUUID(), iat: now, exp: now + 240 })}`
  const sig = createHmac('sha256', amoCreds.secret).update(body).digest('base64url')
  return { Authorization: `JWT ${body}.${sig}` }
}

async function amo(method, path, body) {
  const headers = amoAuth()
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${AMO}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  if (!res.ok) fail(`AMO ${method} ${path}: ${res.status} ${JSON.stringify(json)}`)
  return json
}

async function firefox() {
  // AMO takes 3,000 characters, and the hand viewer URL is about 900 of them,
  // the deal being encoded in it. Our redirect to the same URL stands in, as in
  // Chrome's 500-character box.
  const full = app.amoExtra ? `${notes}\n\n${fenced(app.amoExtra)}` : notes
  const amoNotes = full.replace(
    /https:\/\/www\.bridgebase\.com\/tools\/handviewer\.html\?\S+/g,
    `${DEAL_REDIRECT}\n(a redirect to BBO's hand viewer, with the deal encoded in the URL)`
  )
  if (amoNotes.length > AMO_NOTES_MAX)
    fail(`reviewer notes are ${amoNotes.length} characters; AMO takes ${AMO_NOTES_MAX}`)
  console.log(`==> Firefox: ${app.guid} ${version}`)
  const existing = await fetch(`${AMO}/addons/addon/${encodeURIComponent(app.guid)}/`, { headers: amoAuth() })
  if (existing.status === 404)
    fail(`${app.guid} is not on addons.mozilla.org yet. A first listing needs its description, categories and screenshots: create it in the Developer Hub.`)
  const listed = (await existing.json()).current_version?.version
  console.log(`    listed now: ${listed ?? 'none'}`)
  if (listed === version) fail(`${version} is already the listed version`)

  const form = new FormData()
  form.append('upload', await openAsBlob(pkg('firefox')), basename(pkg('firefox')))
  form.append('channel', 'listed')
  const upload = await amo('POST', '/addons/upload/', form)
  console.log(`    uploaded ${basename(pkg('firefox'))}, validating`)
  let state = upload
  for (let i = 0; !state.processed && i < 60; i++) {
    await sleep(5000)
    state = await amo('GET', `/addons/upload/${upload.uuid}/`)
  }
  if (!state.processed) fail('AMO validation did not finish in five minutes')
  const v = state.validation ?? {}
  console.log(`    validation: ${v.errors ?? '?'} errors, ${v.warnings ?? '?'} warnings, ${v.notices ?? '?'} notices`)
  for (const m of v.messages ?? []) {
    if (m.type === 'error' || m.type === 'warning') console.log(`      ${m.type}: ${m.message} ${m.file ?? ''}`)
  }
  if (!state.valid) fail('AMO rejected the package')

  console.log(`    reviewer notes: ${amoNotes.length} characters`)
  if (!SUBMIT) {
    console.log('    valid; not submitted (rerun with --submit)')
    return
  }
  const create = new FormData()
  create.append('upload', upload.uuid)
  create.append('approval_notes', amoNotes)
  create.append('source', await openAsBlob(pkg('source')), basename(pkg('source')))
  const created = await amo('POST', `/addons/addon/${encodeURIComponent(app.guid)}/versions/`, create)
  console.log(`    version ${created.version} created (id ${created.id}), with the source archive and reviewer notes`)
  if (RELEASE_NOTES) {
    const text = fenced(app.releaseNotes)
    await amo('PATCH', `/addons/addon/${encodeURIComponent(app.guid)}/versions/${created.id}/`, {
      release_notes: { 'en-US': text },
    })
    console.log(`    release notes set (${text.length} characters)`)
  }
  console.log('    submitted for review')
}

// ── Edge Add-ons ────────────────────────────────────────────────────────────

const EDGE = 'https://api.addons.microsoftedge.microsoft.com/v1'
let edgeHeaders
async function edge_(method, path, body, type) {
  edgeHeaders ??= { Authorization: `ApiKey ${keychain('EDGE_API_KEY')}`, 'X-ClientID': keychain('EDGE_CLIENT_ID') }
  const res = await fetch(`${EDGE}${path}`, {
    method,
    headers: { ...edgeHeaders, ...(type && { 'Content-Type': type }) },
    body,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  if (!res.ok) fail(`Edge ${method} ${path}: ${res.status} ${JSON.stringify(json)}`)
  return { location: res.headers.get('location'), json }
}

async function edgeWait(path, what) {
  for (let i = 0; i < 60; i++) {
    const { json } = await edge_('GET', path)
    if (json?.status !== 'InProgress') {
      if (json?.status !== 'Succeeded')
        fail(`Edge ${what}: ${json?.status} ${json?.message ?? ''} ${JSON.stringify(json?.errors ?? '')}`)
      return json
    }
    await sleep(5000)
  }
  fail(`Edge ${what} did not finish in five minutes`)
}

async function edge() {
  console.log(`==> Edge: ${app.name} ${version}`)
  if (!app.edgeProduct)
    fail(`no Edge product id for ${appKey}: copy it from the extension's Overview page in Partner Center into APPS.${appKey}.edgeProduct`)
  const base = `/products/${app.edgeProduct}/submissions`
  const up = await edge_('POST', `${base}/draft/package`, await openAsBlob(pkg('edge')), 'application/zip')
  await edgeWait(`${base}/draft/package/operations/${up.location}`, 'package upload')
  console.log(`    ${basename(pkg('edge'))} is the draft in Partner Center`)
  console.log(`    notes for certification: ${notes.length} characters`)
  if (!SUBMIT) {
    console.log('    not submitted (rerun with --submit, or press Publish in Partner Center)')
    return
  }
  const pub = await edge_('POST', base, JSON.stringify({ notes }), 'application/json')
  await edgeWait(`${base}/operations/${pub.location}`, 'publish')
  console.log('    submitted for review')
}

for (const store of stores) await (store === 'firefox' ? firefox() : edge())
