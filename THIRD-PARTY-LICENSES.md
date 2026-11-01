# Third-Party Licences

Bridge Classroom Fetch is released under [The Unlicense](LICENSE). It
bundles the following third-party code into its published builds.

All three are compiled into the extension bundle by Vite, so their licence terms
travel with every store submission.

---

## linkedom — ISC

A pure-JavaScript DOM used to polyfill `DOMParser`, which MV3 service workers do
not provide. Parsers run identically in the worker and in content scripts as a
result.

- Version: 0.18.12
- Source: https://github.com/WebReflection/linkedom
- Licence: ISC

```
ISC License

Copyright (c) 2020, Andrea Giammarchi

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

---

## webextension-polyfill — MPL-2.0

Mozilla's `browser.*` promise-based wrapper over the callback-style `chrome.*`
APIs, so one source tree runs on Chrome, Firefox, Edge and Safari.

- Version: 0.12.0
- Source: https://github.com/mozilla/webextension-polyfill
- Licence: Mozilla Public License 2.0 — https://mozilla.org/MPL/2.0/

MPL-2.0 is a file-level copyleft. The polyfill is used unmodified; if it is ever
patched, those modified files must be published under MPL-2.0. Nothing else in
this project is affected, and the licence permits distribution in a larger work
under different terms — which is what a bundled extension is.

The full licence text ships in `node_modules/webextension-polyfill/LICENSE` and
is available at the URL above.

---

## bridge-solver — MIT OR Apache-2.0

The double-dummy solver behind the per-card analysis in BBO's History panel,
compiled to WebAssembly. Fetched at build time from a pinned release
(`scripts/solver-wasm.release.json`), not vendored. Used under its MIT option.

- Version: 2.1.0
- Source: https://github.com/bridge-craftwork/bridge-solver
- Licence: MIT OR Apache-2.0

```
MIT License

Copyright (c) 2013-2026 Hanhong Xue (original C++ implementation)
Copyright (c) 2026 Rick Wilson (Rust implementation)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Not bundled

Build and test tooling — Vite, `@crxjs/vite-plugin`, Vitest, Playwright,
Prettier, jsdom — is `devDependencies` only and forms no part of any published
build.
