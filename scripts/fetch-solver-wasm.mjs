#!/usr/bin/env node
// Fetch bridge-solver's WASM package into src/vendor/solver-wasm/, where the
// background imports it to score each card of a BBO board double-dummy (see
// src/background/ddSolver.js).
//
// The package is NOT vendored. It is downloaded from a pinned GitHub release of
// bridge-craftwork/bridge-solver and checked against the SHA-256 committed
// beside the tag in scripts/solver-wasm.release.json. Upgrading is a change of
// `tag` and `sha256` there. src/vendor/ is gitignored. Same scheme, and same
// pin, as Bridge Classroom's scripts/fetch-solver-wasm.mjs.
//
//   node scripts/fetch-solver-wasm.mjs     # runs before every build and test
//
// Local development against an unreleased solver: build the package in the
// sibling checkout (`wasm-pack build --target web` in bridge-solver/wasm) and
// point this script at it:
//
//   SOLVER_WASM_LOCAL=../bridge-solver/wasm/pkg npm run build

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PIN_FILE = join(ROOT, 'scripts', 'solver-wasm.release.json')
const DEST = join(ROOT, 'src', 'vendor', 'solver-wasm')
const FILES = ['bridge_solver_wasm.js', 'bridge_solver_wasm_bg.wasm']

function log(msg) {
  console.log(`fetch-solver-wasm: ${msg}`)
}
class HashMismatch extends Error {}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// The package's version and entry points, by loading it in Node.
async function packageInfo(dir) {
  const glue = await import(
    pathToFileURL(join(dir, 'bridge_solver_wasm.js')).href + `?t=${Date.now()}`
  )
  glue.initSync({ module: readFileSync(join(dir, 'bridge_solver_wasm_bg.wasm')) })
  return {
    version: readJson(join(dir, 'package.json'))?.version ?? null,
    supports_dd_play: typeof glue.Analyzer?.prototype?.dd_play === 'function',
  }
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function fromRelease(pin) {
  const prior = readJson(join(DEST, 'build-info.json'))
  if (
    prior &&
    prior.source === 'release' &&
    prior.tag === pin.tag &&
    prior.sha256 === pin.sha256 &&
    FILES.every((f) => existsSync(join(DEST, f)))
  ) {
    log(`${pin.tag} already in src/vendor/solver-wasm/`)
    return
  }
  const url = `https://github.com/${pin.repo}/releases/download/${pin.tag}/${pin.asset}`
  log(`downloading ${url}`)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const got = sha256(buf)
  if (got !== pin.sha256) {
    throw new HashMismatch(
      `${pin.asset} of ${pin.tag} has SHA-256 ${got}, but scripts/solver-wasm.release.json expects ${pin.sha256}. ` +
        'The release asset changed or the pin is wrong: do not bump the hash without knowing why.'
    )
  }
  const tmp = mkdtempSync(join(tmpdir(), 'solver-wasm-'))
  try {
    writeFileSync(join(tmp, pin.asset), buf)
    execFileSync('tar', ['xzf', join(tmp, pin.asset), '-C', tmp])
    install(join(tmp, 'pkg'))
    const info = await packageInfo(join(tmp, 'pkg'))
    writeInfo({ source: 'release', repo: pin.repo, tag: pin.tag, sha256: pin.sha256, ...info })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function fromLocal(dir) {
  const abs = resolve(ROOT, dir)
  if (!FILES.every((f) => existsSync(join(abs, f)))) {
    throw new Error(
      `SOLVER_WASM_LOCAL=${dir}: no ${FILES.join(' / ')} there (build it with wasm-pack in bridge-solver/wasm)`
    )
  }
  install(abs)
  const info = await packageInfo(abs)
  writeInfo({
    source: 'local',
    tag: null,
    sha256: sha256(readFileSync(join(DEST, 'bridge_solver_wasm_bg.wasm'))),
    ...info,
  })
}

function install(pkgDir) {
  mkdirSync(DEST, { recursive: true })
  for (const f of FILES) copyFileSync(join(pkgDir, f), join(DEST, f))
}

function writeInfo(info) {
  writeFileSync(join(DEST, 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
  log(
    `installed ${info.source === 'local' ? 'a local build' : info.tag}: version ${info.version}` +
      (info.supports_dd_play ? '' : ' (no `Analyzer.dd_play`: per-card analysis will not work)')
  )
}

try {
  const local = process.env.SOLVER_WASM_LOCAL
  if (local) await fromLocal(local)
  else {
    const pin = readJson(PIN_FILE)
    if (!pin?.tag || !pin?.sha256)
      throw new Error('scripts/solver-wasm.release.json needs `tag` and `sha256`')
    await fromRelease(pin)
  }
} catch (err) {
  console.error(`fetch-solver-wasm: ERROR: ${err.message}`)
  process.exit(1)
}
