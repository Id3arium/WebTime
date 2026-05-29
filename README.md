# WebTime

> Track and take control of your time.

A Firefox browser extension that tracks how long you spend on each site and uses
gentle, escalating **interventions** — not hard blocks — to help you stay aware
of and curb mindless browsing.

## Philosophy

WebTime favors **autonomy over coercion**. Instead of slamming a wall in front
of you, it nudges: a quick visual pulse early, an awareness popup when you're
approaching your typical usage, a 60-second wind-down near a session's end, and
a cooldown only once you've actually exceeded a session limit. The goal is to
keep you informed enough to make your own choice.

## Features

- **Per-domain time tracking** with a small on-page timer (click to toggle
  between today's total and current-session time).
- **Phi-spaced nudges** — brief overlays that get more frequent as a session
  nears its end (sparse early, accelerating late).
- **7-day average popup** — when you cross ~80% of your trailing 7-day average
  for a domain, a popup surfaces the trend so you notice before overshooting.
- **Session limits with cooldowns** — after continuous use past a configurable
  limit, a cooldown blocks the page; each successive cooldown grows.
- **Carryover / grace** — ending a session early banks unused time (10% of
  what's left) onto your next session, so stopping is rewarded, not punished.
- **Wind-down mode** — a 60-second visual ramp at the end of a session.
- **Usage chart** in the toolbar popup (30-day history, top domains, 7-day
  moving average).

## Architecture

Three layers, deliberately separated:

| Path | Role |
|------|------|
| [`src/background.ts`](src/background.ts) | The engine: tab tracking, the 1s timer loop, storage/persistence (with data migration), and all intervention dispatch. |
| [`src/content.ts`](src/content.ts) | In-page UI: the timer widget, blur overlay, nudge animation, and all popups. |
| [`src/popup/`](src/popup/) | The toolbar popup (usage chart + settings), bundled to `popup-bundle.js`. |
| [`src/shared/session-math.ts`](src/shared/session-math.ts) | **Pure, browser-free** session math — boundaries, carryover, phi nudge timing, grace, wind-down. Fully unit-tested. |
| [`src/shared/utils.ts`](src/shared/utils.ts) | Pure helpers — domain extraction, time formatting, 7-day stats. |
| [`src/types.ts`](src/types.ts) | Shared type definitions. |

The pure modules in `src/shared/` contain no browser APIs so they can be tested
in isolation with `node --test`.

## Development

Requires Node and (for packaging) [`web-ext`](https://github.com/mozilla/web-ext).

```bash
npm install        # install dev dependencies
npm run typecheck  # tsc --noEmit
npm test           # run the node:test suites in test/
npm run build      # typecheck + bundle to extension/dist/ via esbuild
npm run watch      # tsc in watch mode
```

`npm run build` bundles `background.ts`, `content.ts`, and the popup into
`extension/dist/` (see [`build.mjs`](build.mjs)).

### Full build + package

[`build.sh`](build.sh) runs the typecheck, tests, and then packages a signed-
ready `.xpi` into `artifacts/` with `web-ext`:

```bash
./build.sh
```

## Loading in Firefox

1. Run `npm run build` so `extension/dist/` is populated.
2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on…**
3. Select [`extension/manifest.json`](extension/manifest.json).

The extension is Manifest V2 and targets Firefox (it uses the `browser.*`
WebExtension APIs). Temporary add-ons are removed when Firefox restarts; rebuild
and reload to pick up changes.

## Testing

Tests live in [`test/`](test/) and run via `node --test`. Each suite bundles the
relevant `src/shared/` module with esbuild and imports the **real** source (no
copy-pasted logic), so tests can't silently drift from the implementation:

- [`test/session-math.test.mjs`](test/session-math.test.mjs) — boundaries,
  carryover, end-early, cooldowns, phi nudges, grace, wind-down.
- [`test/seven-day-stats.test.mjs`](test/seven-day-stats.test.mjs) — 7-day
  average stats that drive the average popup.

```bash
npm test
```
