# LuneTube — Architecture

Living document. Companion to `docs/PRD.md` (product spec, read-only) and the
orchestration plan. Updated as phases land.

## Monorepo layout

```
apps/desktop/            one Electron package — src/main, src/preload, src/renderer
packages/shared/         DTOs, Result/LuneError, formatters, the IPC contract   (no runtime deps)
packages/design/         Lunegit-derived tokens, theme codegen, fonts, primitives
packages/youtube/        [Phase 1] the YouTube adapter seam + InnerTube impl + fake
packages/db/             [Phase 3] SQLite schema, migrations, repositories
packages/sponsorblock/   [Phase 4] SponsorBlock client
tests/e2e/               Playwright _electron smoke
```

`pnpm` workspace, `node-linker=hoisted` in `.npmrc`.

### Packaging rule (D4) — only native modules are runtime dependencies

`apps/desktop/package.json` `dependencies` holds **only** genuinely-native
modules (Phase 0: none; `better-sqlite3` joins in Phase 3). Everything else —
`@lunetube/*`, and later `youtubei.js` / `shaka-player` — is a `devDependency`
and is **bundled by electron-vite/rollup** into `apps/desktop/out/`. So
electron-builder (Phase 5) ships `out/` plus at most one rebuilt `.node` binary
and never has to walk pnpm's symlink tree.

`electron-vite`'s `externalizeDepsPlugin` externalises exactly what's in
`dependencies`, which makes this rule mechanical.

> **node-linker=hoisted is retained but unproven for Phase 0.** Empirically,
> Phase 0 typecheck + tests + build are all green under the default
> `node-linker=isolated` too (no native modules, everything Vite-bundled). It is
> kept for Phase 3 (`better-sqlite3` + `@electron/rebuild`) and Phase 5
> (electron-builder), where pnpm's symlinked layout is the documented pain point.
> The Phase 3 implementer must re-verify.

## Process & IPC boundary

|                            | main           | preload         | renderer               |
| -------------------------- | -------------- | --------------- | ---------------------- |
| Node access                | full           | `contextBridge` | none (`sandbox: true`) |
| YouTube / SponsorBlock net | **yes (only)** | no              | no                     |
| SQLite                     | **yes (only)** | no              | no                     |
| MediaSource / shaka        | no             | no              | **yes**                |
| Window / display control   | **yes**        | no              | asks via IPC           |

`webPreferences`: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, `webSecurity: true`, plus the preload.

Main additionally installs:

- **CSP** — strict (`default-src 'none'; script-src 'self'; …
connect/img/media add `http://127.0.0.1:*` for the Phase 1 proxy). Served as a
  response header by the `app://bundle` protocol handler in packaged builds; in
  `electron-vite dev` the renderer is http+HMR and the strict policy is relaxed.
- **`app://bundle` protocol** — packaged builds serve the renderer from a
  privileged `standard`/`secure` scheme rather than bare `file://`, so
  `script-src 'self'` has an unambiguous origin.
- `setPermissionRequestHandler` / `setPermissionCheckHandler` — deny everything
  except `fullscreen` and `media`.
- `setWindowOpenHandler` → `deny` + `shell.openExternal` for `https:` only.
- `will-navigate` guard pinned to the app origin.

### The `window.lune` bridge

Preload exposes exactly one object:

```ts
window.lune: {
  readonly platform: 'darwin' | 'win32' | 'linux'
  invoke<K>(channel: K, payload: IpcRequests[K]): Promise<Result<IpcResults[K], LuneError>>
  on<K>(channel: K, cb: (payload: IpcEvents[K]) => void): () => void
}
```

Channel names live in one `CHANNELS` / `EVENT_CHANNELS` object in
`packages/shared/src/ipc.ts` — main and preload both import it, so they cannot
drift. The preload allow-lists every channel. `defineHandler` in
`apps/desktop/src/main/ipc/registry.ts` wraps each handler so a thrown error
becomes `{ ok: false, error: LuneError }` and never crosses as a raw stack.

The full IPC table (per phase) is the plan's "Full IPC surface" section; the
typed maps in `ipc.ts` grow to match as phases land.

## The adapter seam (PRD §2)

All YouTube knowledge is confined to `packages/youtube`. `src/contract.ts`
declares `YouTubeSource` in terms of **only** `@lunetube/shared` DTOs and
`Result<T, LuneError>`; anything InnerTube-shaped lives under
`packages/youtube/src/innertube/`.

This is **mechanically enforced**: `eslint.config.js` has a
`no-restricted-imports` rule forbidding `youtubei.js` everywhere except
`packages/youtube/src/innertube/**`. A future Piped/Invidious backend implements
`YouTubeSource` in a sibling directory; the factory picks one.

Because youtubei.js returns live class instances that can't cross
`structuredClone`, the adapter returns plain DTOs plus **opaque continuation
handles**; main keeps a small TTL'd LRU so pagination still works.

## Media path (Phase 1, design fixed now)

Metadata runs in main (Node `fetch` sends no `Origin`, no CORS). Media bytes
never cross IPC: main runs a loopback `http.Server` on `127.0.0.1:0`, and
`toDash()`'s `url_transformer` rewrites every googlevideo URL to it. Shaka in the
renderer fetches ranged bytes from `http://127.0.0.1:<port>/<token>/…`. The same
proxy serves thumbnails (disk-cached, same-origin for canvas colour extraction)
and `timedtext` captions. Host matching is anchored-regex against
`new URL(target).hostname`; a per-launch 32-byte path token gates every route.

Playback strategy is behind a `PlaybackStrategy` seam: `ClassicDashStrategy`
(IOS client → `toDash()` → shaka) is the only Phase 1 implementation; `SabrStrategy`
is a named, empty slot.

## Design system

`packages/design`: `tokens/base.css` (Lunegit white-alpha baseline) →
`themes/generated/themes.css` (generated by `scripts/gen-theme-css.mjs` from the
5 vendored Lunegit theme JSONs) → `tokens/{typography,layout,glass}.css` +
`primitives/` + self-hosted variable WOFF2 fonts.

- Typography is **locked** (PRD §7): Hanken Grotesk body/UI/numerals, Bricolage
  Grotesque large-display only, **no fixed-pitch family anywhere** — numerals get
  `.tnum` (`font-variant-numeric: tabular-nums`). A design guard test enforces
  no `/mono(space)?/i` in the token layer.
- Glass: two blur layers max (PRD §7 budget). `--glass-material-opacity` defaults
  to `0.7` (decision A4); each theme also exposes `--glass-opacity-option` for
  the "glass level" setting.
- Fonts are self-hosted (decision A7) — no `fonts.googleapis.com`.

## Version pins that are load-bearing (plan F6 / R7)

An implementer who runs `pnpm add -D typescript@latest` or `vite@latest` breaks
the build:

- **`typescript@~6.0.3`** — `typescript-eslint@8` peers `typescript <6.1.0`; TS 7
  breaks lint.
- **`vite@~7.3.6`** + **`@vitejs/plugin-react@^5.2.0`** — `electron-vite@5` peers
  `vite ^5||^6||^7`, i.e. not Vite 8.
- `@swc/core@^1` is an `electron-vite` peer and must be installed even if unused.
- `pnpm@11` replaced `onlyBuiltDependencies` with an `allowBuilds` map in
  `pnpm-workspace.yaml`.

## CI

`.github/workflows/ci.yml`: PR + push to `main`, 3-OS matrix
(ubuntu/windows/macos). `pnpm install --frozen-lockfile` → `typecheck` → `lint`
→ `format:check` → `test` → `build`; the Playwright electron smoke runs on Linux
only, under `xvfb-run`. **No publish step, and no step contacts YouTube** — CI
uses `FakeYouTubeSource` from Phase 1 on (GitHub datacenter IPs get bot-blocked;
plan F2/R2).
