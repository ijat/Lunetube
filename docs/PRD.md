# LuneTube — Product & Technical Spec

A standalone, beautiful desktop YouTube player. Glassmorphism and motion everywhere,
typography-forward, built on the **Lunegit** design language.

Status: **direction locked — build phase** · Last updated: 2026-09-03

**Chosen visual direction: B · "Cinema"** (from `docs/mockups.html`) — the video leads.
No left nav rail; a single floating top bar; edge-to-edge player; a bottom now-playing
dock instead of a side queue drawer; oversized expressive titles; the whole shell subtly
re-tints to the current video's dominant colour. Ambient glow + shared-element
thumbnail→player motion.

---

## 1. Product vision

A desktop app that replaces youtube.com for watching: you search, browse channels,
queue videos, and watch in a fully custom player wrapped in Lunegit-style acrylic glass.
No ads, no YouTube chrome, no browser. Every surface is glass over a living backdrop;
every transition is animated; text is treated as a first-class design material.

Non-goals (v1): uploading, live-stream chat, Studio/creator tools, being a general web browser.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| **Content source** | **InnerTube via `youtubei.js`** — fully custom player, no ads, unlimited search. Accepted trade-off: ToS gray area (personal-use risk low) and periodic maintenance when YouTube changes internals. All YouTube access goes through one adapter module so a future swap (self-hosted Piped/Invidious) is a single seam. |
| **Stack (primary)** | **Electron + React + TypeScript.** Bundled Chromium = identical playback (VP9/AV1, captions, PiP) and full animation headroom (framer-motion, WebGL backdrop) on every OS. |
| **Stack (fallback)** | **Avalonia (.NET)** — same stack as Lunegit, glassmorphism already proven there. Trigger a fallback evaluation only if Electron playback of InnerTube-resolved streams proves unreliable or the InnerTube integration is unworkable in the renderer. In the Avalonia path, InnerTube is replaced by `YoutubeExplode` (.NET) and the player by libmpv/LibVLCSharp. |
| **Auth** | **Anonymous-first.** The entire app must work with zero sign-in (search, trending, watch, plus local library). Optional sign-in via one-time embedded-webview YouTube login (reuse session cookies for a personalized home feed + real subscriptions) is a **later** enhancement, designed-for but not built in milestone 1. |
| **MVP scope** | Large. All four feature groups below are milestone 1. |
| **Theme** | Dark-only for v1. Lunegit accent themes selectable: **Blue (default)**, Purple, Green, Orange, Dark-Modern. The "claude cream" `#C96442` palette is explicitly excluded. |
| **Distribution** | GitHub Actions CI produces signed standalone binaries per push-to-tag: macOS `.dmg` + `.app` (notarized), Windows `.exe` (NSIS) + portable, Linux `AppImage`. In-app auto-update. |

---

## 3. Milestone 1 (MVP) — feature groups

### 3.1 Core watch + search
- Search: query box with filters — upload date, duration, type (video/channel/playlist),
  sort (relevance/date/views/rating). Result list with rich cards.
- Watch page: custom player, title, view/date, expandable description with **clickable
  timestamps** and link handling, channel row (avatar, name, sub count, follow button).
- Related / up-next rail; autoplay toggle (persisted).

### 3.2 Queue + local library (all local, SQLite)
- Queue: "play next", "add to queue", reorderable, persists across sessions.
- Local playlists: create / rename / delete / reorder, add from any video card.
- Local history: automatic, searchable, clearable, per-item remove, pause-history toggle.
- Local Watch Later.
- Followed channels (local list) + a combined "latest from followed" feed.

### 3.3 Channel + comments
- Channel page with tabs: Videos, Shorts, Playlists, About. Sort/paginate videos.
- Threaded comments: top-level + replies, sort (top / newest), like counts, hearted/pinned
  badges, author highlighting, load-more. Timestamps in comments are clickable.

### 3.4 Player power features
- Quality selector (up to source max), playback speed, loop.
- Captions: track selector + **caption styling** (font, size, background opacity, edge style).
- Audio-only mode (resolves audio stream, keeps playback, dims/hides video surface).
- Chapters (from description or API), chapter markers on the scrubber.
- Scrubber with **hover preview thumbnails** (storyboard spec) and chapter segmentation.
- Picture-in-Picture (OS-native) + detached **mini-player** window (always-on-top, resizable).
- **SponsorBlock** integration: skip/mute/highlight configurable per category, with a visible
  segment overlay on the scrubber.
- Full window/fullscreen mode set (§5).
- Keyboard shortcuts (§6) with a discoverable overlay (`?`).

---

## 4. Deferred (milestone 2+)

Downloads (yt-dlp, video/audio) · Shorts vertical viewer · DeArrow (de-clickbait) ·
Return YouTube Dislike · Chromecast · multiple profiles · Google-OAuth path ·
light theme · i18n · trending-by-region tuning · "ambient/theater" per-monitor extras.

---

## 5. Window & fullscreen modes

1. **Normal windowed** — frameless, Lunegit chrome (32px draggable titlebar; native traffic
   lights on macOS), resizable.
2. **Maximized.**
3. **Borderless windowed fullscreen** — fills the current monitor, no chrome, instant alt-tab.
4. **Exclusive fullscreen** — native fit-to-monitor.
5. **Player-only fullscreen** — video fills the app window, app chrome collapses; app itself
   stays windowed (good for side-by-side).
6. **Theater / cinema mode** — wide video within the browsing layout.
7. **Mini-player** — detached always-on-top window; **PiP** — OS compositor.
8. **Multi-monitor**: choose which monitor a fullscreen targets; support "fullscreen video on
   monitor 2 while the library stays on monitor 1".
9. Last mode is remembered. Global media keys + configurable global shortcuts.

---

## 6. Keyboard shortcuts (baseline)

`Space`/`K` play-pause · `J`/`L` −/+10s · `←`/`→` −/+5s · `,`/`.` frame step (paused) ·
`↑`/`↓` volume · `M` mute · `F` fullscreen · `T` theater · `I` mini-player · `C` captions ·
`<`/`>` speed · `0–9` seek % · `N`/`P` next/prev in queue · `/` focus search · `?` shortcut overlay.

---

## 7. Design system — Lunegit language

Source of truth on disk: `~/Projects/AvaloniaApps/Project Lunegit`
(`src/Lunegit.Desktop/Themes/DarkTheme.axaml`, `SampleThemes/*.json`, `App.axaml`,
`Theming/ThemeApplicator.cs`).

### Tokens (dark baseline)
- **Foreground**: white at graded alpha — primary `#CCFFFFFF`, secondary `#AAFFFFFF`,
  tertiary `#88FFFFFF`, quaternary `#66FFFFFF`, faint `#44FFFFFF`.
- **Surfaces**: white-alpha overlays — input `#0AFFFFFF`, hover `#10FFFFFF`,
  overlay `#15FFFFFF`, selected `#18FFFFFF`, active `#20FFFFFF`, border `#30FFFFFF`,
  divider `#40FFFFFF`.
- **Glass material opacity: 0.7 baseline** (the value the user confirmed; 0.35 was rejected
  as too transparent).
- **Accent** (theme-swappable): Blue `#71B0F7` default; Purple / Green / Orange / Dark-Modern.
  Accent is used sparingly — links, focus rings, active toggles, scrubber fill, small
  highlights.
- **No accent-filled buttons.** Primary buttons are muted `SurfaceInput` fills,
  `CornerRadius=6`, `MinHeight=32`, control `FontSize=13`.
- Semantic: success `#4CAF50`, warning `#FFC107`, error `#F44336`.

### Glass & backdrop
- Every panel is acrylic: blurred translucent surface + 1px `SurfaceBorder` hairline +
  soft inner highlight.
- **Blur budget**: cap stacked blur layers (2, maybe 3) — GPU-expensive. Backdrop blur on the
  root layer + one panel layer; nested cards use flat alpha, not more blur.
- **Living backdrop** behind the glass:
  - Idle/browse: slow animated mesh gradient tinted by the active accent + subtle grain.
  - Watch page: **dominant-color wash extracted from the current video's thumbnail** — the
    whole app subtly re-tints per video (ambient theming). Animate the transition.
- Frameless window, extended client area, `GridSplitter`-style resizable panels.

### Typography (locked)
- **Default / body / UI / numerals**: **Hanken Grotesk** (OFL, Google Fonts) — a
  Helvetica/Neue-Haas-lineage screen grotesque. This is the app's default face; use it for
  everything unless a rule below says otherwise. (If exact Helvetica/Arial metrics are ever
  wanted, **Arimo** is the metric-compatible fallback.)
- **Display — large titles & section headers only**: **Bricolage Grotesque** (OFL) — the
  expressive oversized face that gives Direction B its character. Used at large sizes only
  (video title, page/section headers, hero card titles); never for body or controls.
- **No monospace anywhere.** Timestamps, view counts, durations, scrubber time, keyboard
  hints — all set in Hanken Grotesk with `font-variant-numeric: tabular-nums`. Do not
  introduce a mono family.
- `text-wrap: balance` on titles; 2-line clamp with graceful ellipsis on cards.
- Fluid type scale; deliberate line-heights; documented in the design tokens package.
- Numbers formatted compactly (`1.2M views`, `3:04:11`).

### Motion
- Spring physics (framer-motion). Shared-element transition: thumbnail → player (the card's
  thumbnail flies into the player surface).
- List entrance stagger; hover micro-interactions; skeleton shimmer while loading;
  page cross-fades with slight parallax; animated scrubber and volume.
- **Respect `prefers-reduced-motion`** — reduce to opacity-only fades.

### Iconography
Lucide (consistent stroke weight, matches Lunegit's restrained feel).

---

## 8. Architecture (Electron path)

```
apps/
  main/         Electron main — windows, tray, global shortcuts, auto-update, IPC
  preload/      context-isolated bridge
  renderer/     React app (routes, player, design system)
packages/
  youtube/      InnerTube adapter (youtubei.js) — the ONLY module that knows about YouTube
  sponsorblock/ SponsorBlock client + segment model
  db/           SQLite (better-sqlite3) — history, playlists, queue, watch-later, follows, settings
  design/       tokens (from Lunegit), fonts, primitives, motion presets
  shared/       types, formatters (durations, counts), result/error types
```

- **Playback**: InnerTube resolves adaptive stream URLs; renderer plays via a `<video>`
  element with a small DASH/adaptive shim (or `shaka-player`) for quality switching and
  separate audio/video tracks. Storyboard endpoint drives scrubber preview thumbnails.
- **State**: TanStack Query for remote reads (cache + dedupe), Zustand for player/queue/UI.
- **Security**: `contextIsolation: true`, `nodeIntegration: false`, strict CSP in renderer,
  all YouTube/SponsorBlock/network calls in main or a dedicated privileged process.
- **Resilience**: the YouTube adapter wraps every call in typed results; a single
  "YouTube changed something" error surface with retry + a diagnostics panel.

---

## 9. Non-functional

- **Target OS**: macOS (Apple Silicon) primary; Windows + Linux built and smoke-tested in CI.
- **Performance**: virtualized result/comment lists, lazy + cached thumbnails (disk cache),
  60fps scroll, blur budget respected, video decode hardware-accelerated.
- **Storage**: single SQLite file in app data dir; schema migrations; export/import of local
  library as JSON.
- **Privacy**: zero telemetry. No analytics. Network calls limited to YouTube InnerTube,
  SponsorBlock, thumbnail/asset CDNs.
- **Accessibility**: full keyboard nav, focus-visible rings, ARIA on controls, reduced-motion,
  caption styling, respects OS text-size where feasible.
- **Updates**: `electron-updater` against GitHub Releases (Velopack in the Avalonia fallback).
- **Config**: settings screen — appearance (accent theme, glass level, motion),
  playback defaults (quality, speed, autoplay), SponsorBlock categories, shortcuts,
  history toggle, data management.

---

## 10. CI / CD

- **CI** (every PR): typecheck, lint, unit tests (Vitest), a headless Playwright smoke of the
  renderer, build the app for all three OSes (no publish).
- **Release** (tag `v*`): matrix build → sign & notarize macOS → Windows Authenticode (if a
  cert is available; otherwise unsigned portable) → Linux AppImage → create GitHub Release
  with artifacts + generated changelog → auto-update feed updated.
- Secrets: Apple ID / app-specific password / Developer ID cert, Windows cert (optional),
  GitHub token. Documented in `docs/RELEASING.md`.
- Version source: `version.json` (mirrors Lunegit's convention).

---

## 11. Resolved from the mockup round

1. **Direction: B · Cinema** (see header + `docs/mockups.html`).
2. **Typography**: Hanken Grotesk default, Bricolage Grotesque for large display only, no mono (§7).
3. **Layout shell**: no left rail. Floating top bar (logo, search, Home/Following/History/Playlists,
   avatar). Content edge-to-edge. Queue = bottom **now-playing dock**, not a side drawer.
4. **Backdrop**: per-video **dominant-colour wash** is the primary treatment — the whole shell
   re-tints per video, animated. A slow accent mesh + faint grain underneath. Blur budget: 2 layers.
5. **Watch page**: immersive/full-bleed player; theater-leaning. Meta (title, channel, actions),
   then description, then comments in a single column; related lives in the dock's "up next".
6. **Cards**: generous, `--card-radius:16px`, display-face titles at large size, subtle hover
   lift with a coloured glow, channel avatar shown.
7. Evolution of Lunegit (not literal) — keeps the glass tokens, surfaces, "no accent-filled
   buttons" rule, frameless chrome; diverges on layout and type scale for a media app.

---

## 12. Delivery method

After mockups are chosen, implementation runs via the **orchestrate** skill (planner →
implementer → code review → optional security review → merge) in a git worktree, paced
against usage limits, looping until the milestone is complete.
