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
  except `fullscreen` (`<video>` playback needs no capture permission).
- `setWindowOpenHandler` → `deny` + `shell.openExternal` for `https:` only.
- `will-navigate` guard pinned to the app origin by real origin comparison
  (`protocol//host`, since `URL.origin` is `"null"` for the `app:` scheme).

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
becomes `{ ok: false, error: LuneError }` and never crosses as a raw stack, and
takes an optional `validate(payload)` to narrow the untrusted renderer payload
(decision A9). `app:setSettings` additionally re-validates every field in
`settings.ts#coerce` (type + range + enum + `https:` checks, unknown keys
dropped) before anything reaches disk. `window.lune` is reached only through
`renderer/bridge.ts` (`bridge()` / `hasBridge()`), which surfaces a preload-load
failure as a visible error screen rather than a blank window.

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

### Continuation handles (Phase 2 / decision A13)

`packages/youtube/src/innertube/continuations.ts`. A handle is
`` `${kind}:${uuid}` `` for `kind ∈ {search, comments, replies-first,
replies-more, channel, playlist}`. The store is **main-side only and never
persisted** — it is process memory with a **30 min TTL** and a **cap of 1000**
entries (LRU eviction). The cap is sized for P2-5's mint rate: reply pagination
mints one `replies-first:` handle per comment thread that has replies (~10-20 per
comment page), and a stale-refetch re-runs every page, so a slot is cheap (one
`Map` entry — the parent `Comments` already retains its threads). Properties that
matter:

- `get(kind, handle)` returns `undefined` unless the handle's prefix matches the
  channel's `kind`. Handles are untrusted renderer input (A9); feeding a
  `yt:comments` handle to `yt:channel` would otherwise land as a `TypeError`
  deep inside youtubei.js. A stale / expired / forged handle comes back as
  `INVALID_INPUT` with `detail: 'continuation:<kind>'`, which the renderer's
  `isStaleContinuation()` turns into a "this list refreshed — reload" affordance.
- A `WeakMap<object, Map<kind, handle>>` dedupes by object identity: `put`ing
  the same live feed object under the same kind returns the **existing** handle
  rather than minting a second one.
- **`yt:related` has no handle at all.** `VideoInfo.getWatchNextContinuation()`
  returns `this` after replacing `watch_next_feed` **in place**
  (`VideoInfo.js:171-186`), so any handle over it silently advances a hidden
  cursor on a retry, a back-navigation or a StrictMode double-invoke — the F13
  bug. It was the only such aliasing continuation in the whole Phase-2 surface,
  so up-next was made a single ~20-item page (`GetRelatedParams` /
  `IpcRequests['yt:related']` carry no `continuation`) and the store was hardened
  for the six kinds that remain.

### IPC surface added in Phase 2 (`apps/desktop/src/main/ipc/youtube.ts`)

Seven `defineHandler` registrations, each forwarding a **validated** payload
straight to the matching `YouTubeSource` method. Every validator rejects with
`INVALID_INPUT` and never calls the source on bad input:

| channel                | validator(s)                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yt:search`            | `requireSearchQuery` (1–256, trimmed) · `coerceSearchFilters` (field-by-field from `DEFAULT_SEARCH_FILTERS`, unknown keys dropped) · `requireContinuation` (optional, ≤128) |
| `yt:searchSuggestions` | `requireSuggestionQuery` (1–100, trimmed)                                                                                                                                   |
| `yt:comments`          | `requireVideoId` · `requireCommentSort` (∈ `top`/`newest`, default `top`) · `requireContinuation`                                                                           |
| `yt:commentReplies`    | `requireBoundedString('handle', 128)` — the opaque `replies-first:` / `replies-more:` handle (A17)                                                                          |
| `yt:channel`           | `requireBoundedString('channelId', 64)` · `requireChannelTab` (∈ the 6 `ChannelTab` literals) · `requireContinuation`                                                       |
| `yt:playlist`          | `requireBoundedString('playlistId', 64)` · `requireContinuation`                                                                                                            |
| `yt:resolveUrl`        | `requireUrl` (1–2048)                                                                                                                                                       |

**Preload is not touched** — the invoke allow-list is derived from `CHANNELS`
(`new Set(Object.values(CHANNELS))`), so a new channel name is enough.

### `resolveUrl` — anchored host allow-list, allow-list before fallback

`packages/youtube/src/innertube/map/url.ts`. `parseYouTubeUrl` runs
**locally first** and only against an **anchored** host allow-list matched on
`new URL(raw).hostname` (never `endsWith`, which `youtube.com.evil.com` defeats):
`^(www\.|m\.|music\.)?youtube\.com$`, `^youtu\.be$`,
`^(www\.)?youtube-nocookie\.com$`. It also rejects userinfo (`user@host`), a
non-`http(s)` scheme, and a length over 2048. Only after a URL clears that gate
is a network hop considered — a `/@handle` / `/c/` / `/user/` path returns
`null` locally and `source.ts` resolves it via `yt.resolveURL` and
**re-validates** the returned `videoId` / `playlistId` / `browseId`. A
non-allow-listed host returns `{ kind: 'unknown' }` with **no network at all**;
a bare phrase returns `{ kind: 'search' }`. The renderer's paste-a-URL path
(`shell/TopBar.tsx`) honours `video` / `channel` / `playlist` / `search`, but a
URL-shaped string that comes back `{ kind: 'unknown' }` — or that fails
resolution — shows an inline "That doesn't look like a YouTube link" note and
**stops**: it is never re-issued as a verbatim YouTube search, which would
egress the whole URL (path + query) to Google (security S5). A scheme-less
string the resolver hands straight back as `{ kind: 'search', query: <the input
verbatim> }` is treated the same way (security S6).

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

### Network egress hosts

Everything the app talks to, all from **main** (renderer egress is CSP-pinned to
`'self'` + `http://127.0.0.1:*`):

| host                                                       | who              | what                                                                                                |
| ---------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `www.youtube.com` / `youtubei` endpoint                    | youtubei.js      | InnerTube metadata (search, video, comments, channel, playlist)                                     |
| `*.googlevideo.com`                                        | proxy `/media`   | adaptive media segments                                                                             |
| `i*.ytimg.com`, `yt*.ggpht.com`, `*.googleusercontent.com` | proxy `/img`     | thumbnails + avatars (disk-cached, same-origin for canvas)                                          |
| `www.youtube.com/api/timedtext`                            | proxy `/caption` | caption tracks                                                                                      |
| `suggestqueries-clients6.youtube.com`                      | youtubei.js      | **added in Phase 2** — search-suggestion autocomplete (`getSearchSuggestions` → `/complete/search`) |

### Player core (P1-5) — `apps/desktop/src/renderer/player/`

`PlaybackEngine` wraps `shaka.Player@5.2.8`. It imports **no** shaka: it talks to
a narrow structural interface (`ShakaPlayerLike`) and takes an injected
`createPlayer()`. `shakaPlayer.ts` is the only module that imports shaka, and by
declaring `createShakaPlayer(): ShakaPlayerLike` it makes `tsc` prove the real
player still satisfies every method the engine calls; `assertShakaConstants()`
does the same at runtime for the numeric error-code enums.

**Stream recovery is the load-bearing behaviour.** googlevideo URLs expire and 403. On `BAD_HTTP_STATUS` 403/410, `HTTP_ERROR`, or a segment request issued past
`StreamManifest.expiresAt`, the engine captures `currentTime` + play state,
re-resolves `yt:streams` through the query layer, reloads, and restores. Four
invariants hold it together: the `<video>` element is authoritative for time;
track choices are stored as _preferences_, never as shaka `Track` objects (shaka
invalidates those on unload); a debounce timer collapses a burst of segment
failures into exactly one re-resolve; and a `#generation` epoch means a
superseded recovery is a no-op rather than a clobber. Two consecutive failed
attempts latch a `degraded` flag on `usePlayerStore` and **stop** the loop —
unbounded retries against a hard 403 are how you get the user's IP blocked.

`usePlayerStore` (Zustand) mirrors the element on a rAF tick, `set`ing only
fields that actually changed. Controls read it through selectors and call the
engine; nothing writes playback state into the store except the tick.

> **CSP.** `connect-src` in `PROD_CSP` grants `blob:`. The DASH manifest is
> handed to shaka as an object URL, and shaka _fetches_ it — which CSP scores
> against `connect-src`, where `'self'` deliberately does not cover `blob:`.
> Without the grant the player cannot load anything in a packaged build.

### Watch page (P1-6) — `apps/desktop/src/renderer/routes/watch/`

Direction-B layout: full-bleed player, meta block (`26px 30px 0`), then Phase-2
comments/related placeholders. The player **mounts on the first play click**, not
on route entry — the poster is shown first. This keeps the `LUNE_FAKE_YT=1` e2e
path network-free (the fixture's googlevideo URLs are expired) with no test-only
branch, and sidesteps Chromium's autoplay policy.

`DominantColorWash` runs `node-vibrant` over the thumbnail and writes
`--wash-a` / `--wash-b` / `--glow` on `:root`; the ~1.1s cross-fade is the CSS
`transition` on `.backdrop::before` / `::after`.

> **Images and CSP.** `img-src` allows only `'self' data: blob: http://127.0.0.1:*`
> — no `https:`. So thumbnails and avatars must reach the renderer **already
> rewritten to the `/img` proxy**: `getVideo` / `getRelated` route them through
> the injected image rewriter (`map/video.ts`, identity when none is injected —
> the `FakeYouTubeSource` / `LUNE_LIVE` case). `renderer/lib/img.ts`
> `loopbackImage()` is the guard: components render `<img>` (and the wash reads
> pixels) only for a `127.0.0.1` URL, else they fall back to a gradient
> placeholder. Proxying is also what keeps the colour-extraction canvas
> untainted (the `/img` route sets `Access-Control-Allow-Origin`).

## List virtualization (Phase 2 / decisions A19, P2-F11)

Long lists (search results, channel tabs, comments, Home shelves) are windowed
with `@tanstack/react-virtual` (bundled — `apps/desktop` keeps its no-runtime-deps
rule). The contract:

- **One scroller for the whole app.** `.stage__content` in `AppFrame` is the
  only scrollable element. `ScrollContainerProvider` publishes it through
  context (as _state_, not a bare ref — a descendant's layout effect can run
  before `<main>`'s ref is attached). A virtualizer **never** nests its own
  scrollbox.
- **`scrollMargin`.** Because the virtualized area is partway down the shared
  scroller, each virtualizer measures
  `round(sizerRect.top − scrollerRect.top − scroller.clientTop + scroller.scrollTop)`
  on every commit (plus a `ResizeObserver` on the sizer and on the scroller) and
  positions rows at `translateY(item.start − scrollMargin)` inside a
  `height: getTotalSize()` sizer. Multiple virtualizers on one page (the two
  Home shelves) each carry their own margin.
- **Stable keys.** `flattenComments` derives every row key from a comment id,
  never an index: `@tanstack/virtual-core` keys its measured-height cache by
  `getItemKey(index)`, so a splice (expanding a thread mid-list) must not shift
  keys or the list jumps.
- **Not testable in jsdom** (no layout) — pure helpers (`columnsForWidth`,
  `flattenComments`) are unit-tested; real windowing/anchoring behaviour is
  covered in Playwright (`tests/e2e/browse.spec.ts`).

## Design system

`packages/design`: `tokens/base.css` (Lunegit white-alpha baseline) →
`themes/generated/themes.css` (generated by `scripts/gen-theme-css.mjs` from the
5 vendored Lunegit theme JSONs) → `tokens/{typography,layout,glass}.css` +
`primitives/` + self-hosted variable WOFF2 fonts.

- Typography is **locked** (PRD §7): Hanken Grotesk body/UI/numerals, Bricolage
  Grotesque large-display only, **no fixed-pitch family anywhere** — numerals get
  `.tnum` (`font-variant-numeric: tabular-nums`). A design guard test enforces
  no `/mono(space)?/i` in the token layer.
- Glass: two blur layers max (PRD §7 budget). All blur values are tokens
  (`--blur-root` / `--blur-panel` / `--blur-bar`). `--glass-material-opacity`
  defaults to `0.34` (decision A21 — lowered from A4's `0.7`, which assumed an
  opaque window); `.glass-root` tints with the per-theme `--glass-tint-rgb`;
  each theme also exposes `--glass-opacity-option` for the "glass level" setting.
- Fonts are self-hosted (decision A7) — no `fonts.googleapis.com`.
- The accent-theme id set has one home: `ACCENT_THEMES` / `ACCENT_THEME_LABELS`
  in `@lunetube/shared`. `gen-theme-css.mjs` throws on any source-JSON /
  `THEME_ORDER` mismatch, and `renderer/theme-ids.test.ts` fails CI if the
  generated CSS drifts from `ACCENT_THEMES`.

## Window materials / glass (decision A21)

The window is **transparent to the desktop** and the OS compositor's material
sits behind the renderer. The renderer then splits every surface into one of
three tiers:

| tier                | surfaces                                                               | treatment                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chrome**          | top bar, now-playing dock                                              | Clear glass — a near-invisible tint (`rgb(255 255 255 / 0.02)`) over one `backdrop-filter` blur; the OS material carries it. Small text takes `--text-shadow-glass` for legibility over any wallpaper.                                                |
| **Content surface** | cards, panels, filter bars, channel header, comment rows, home shelves | A **subtle glass tint** via `--glass-1` / `--glass-2` (white-alpha, `~0.045` / `~0.075`) — these read as a faint frost over vibrancy, not as the near-opaque fills A4 assumed over the old `--void`. Nested cards use flat alpha, never a third blur. |
| **Opaque stage**    | the `<video>` element, the click-to-play poster / gradient placeholder | Fully opaque (`#05070b`). **No desktop bleed through a playing frame.**                                                                                                                                                                               |

**Making a new surface glass-correct** (for the P2 route steps):

- Decorative container → `.glass-panel` (one blur) or `.glass-flat` (no blur);
  never stack another `backdrop-filter`.
- Text on a surface that sits on the transparent stage inherits
  `--text-shadow-glass` from `.stage__content`. **Reset `text-shadow: none`** on
  (a) large Bricolage display type (≥28px — a shadow reads as mud; `.display`,
  `.route__title`, `.watch__title` already do this) and (b) long-form body copy
  on a tinted surface (the watch description; comment bodies in P2-10).
- The per-video `DominantColorWash` and the drifting `Backdrop` blobs write
  `--wash-a` / `--wash-b` (≈`0.12` / `0.08` alpha) and `--glow` (≈`0.30`) — a
  hint of colour on the glass, not a wash that fights the translucency. The
  ~1.1 s cross-fade is the CSS `transition` on `.backdrop::*`; global.css's
  reduced-motion block (`*, *::before, *::after`) collapses it.

**Per-platform behaviour** (`apps/desktop/src/main/windows/mainWindow.ts`):

| OS                   | mechanism                                                                                                                                                                                                  | notes                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **macOS**            | `vibrancy: 'under-window'` + `visualEffectState: 'active'` + transparent `backgroundColor` (`#00000000`); `titleBarStyle: 'hiddenInset'`, `trafficLightPosition` y-centred in the 44 px bar (`(44−16)/2`). | Renders as Liquid Glass on macOS 26+; plain vibrancy below that.                                                                                                                                                                                                                                                                                                                         |
| **Windows 11 22H2+** | `backgroundMaterial: 'acrylic'` + `titleBarOverlay`; `backgroundColor` stays opaque `#0a0d13`.                                                                                                             | Frameless + acrylic has a known Electron quirk: the acrylic backdrop can swallow the resize hit-region near the window edges — acceptable for now, revisit if users report hard-to-grab edges. On **pre-22H2 Windows** `backgroundMaterial` is a silent no-op and the opaque `#0a0d13` `backgroundColor` shows through — degrades to a normal dark window, never a broken/invisible one. |
| **Linux**            | none — Electron exposes no compositor material API. `backgroundColor` opaque `#0a0d13`; the acrylic option is a harmless no-op.                                                                            | Gets only the in-app frost (`backdrop-filter` blurs the app's own gradient/backdrop). Visually flatter than mac/Win but fully functional.                                                                                                                                                                                                                                                |

The safety property: `backgroundColor` is only transparent on macOS, where
vibrancy is guaranteed to be available. Everywhere else it is the opaque
`--void`, so a missing/unsupported compositor material can only ever fall back
to a solid dark window.

## What is not built yet

| area                                                  | state after Phase 2                                                                                                                                                                                              | lands in                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Persistence**                                       | None. "Continue watching" is a session-scoped in-memory store (`renderer/stores/recentStore.ts`, cap 10) that empties on quit and says so in the UI. No history, follows, Watch Later, local playlists or queue. | Phase 3 (SQLite via `db:*`; the Home shelf's data source swaps to `db:history` with no layout change)                                    |
| **"Latest from followed"**                            | A labelled placeholder on Home. Not faked — the follows table does not exist and the fan-out needs its own rate-limiting design.                                                                                 | Phase 3                                                                                                                                  |
| **Follow / like / Save / autoplay-next / "Play all"** | Visible where they belong but **disabled with a reason** — never present-and-inert.                                                                                                                              | Phase 3                                                                                                                                  |
| **Live playback**                                     | Cards show a LIVE badge; the watch route gives a precise "live streams are not playable yet" state. `toDash()` provably throws for live.                                                                         | Phase 4 (`LiveHlsStrategy` behind the existing `PlaybackStrategy` seam, alongside the `PlaybackEngine` manifest-refresh rework it needs) |
| **Player power features**                             | P1-5's quality/speed/caption-toggle subset only. No caption styling, chapters, storyboard scrub previews, SponsorBlock, PiP, mini-player, window modes, or the full §6 shortcut set.                             | Phase 4                                                                                                                                  |
| **Shorts vertical viewer**                            | Shorts appear as cards and play on the normal watch page.                                                                                                                                                        | later (PRD §4, milestone 2+)                                                                                                             |
| **Comment posting / sign-in**                         | Out of MVP scope entirely.                                                                                                                                                                                       | —                                                                                                                                        |
| **Packaging / signing / auto-update**                 | CI builds all 3 OSes but publishes nothing; no `electron-builder` config yet.                                                                                                                                    | Phase 5                                                                                                                                  |

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
