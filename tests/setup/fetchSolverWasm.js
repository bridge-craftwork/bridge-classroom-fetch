// The solver tests load the real bridge-solver package, which is fetched rather
// than committed. Fetch it once before any test runs; a no-op when present.
import { execFileSync } from 'node:child_process'

export default function setup() {
  execFileSync(process.execPath, ['scripts/fetch-solver-wasm.mjs'], { stdio: 'inherit' })
}
