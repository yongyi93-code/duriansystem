---
name: run-durian-dashboard
description: Build, run, and drive the durian dashboard (dashboard/index.html). Use when asked to start the durian dashboard, screenshot it, click through its views, or check that a change to dashboard/app.js renders correctly.
---

This is a static vanilla-JS app (no build step, no package.json for the
app itself) — `dashboard/index.html` + `dashboard/app.js` + `dashboard/style.css`,
opened from a plain HTTP server. Drive it with the Playwright driver at
`.claude/skills/run-durian-dashboard/driver.mjs`.

All paths below are relative to `duriansystem/` (the repo root).

## Prerequisites

```bash
node --version   # any recent Node works; tested with v24
python3 --version  # used only as a static file server
```

## Setup (one-time)

The driver needs Playwright + a downloaded Chromium installed locally in
the skill dir (npm packages aren't available at repo root since this app
has no package.json):

```bash
cd .claude/skills/run-durian-dashboard
npm install            # installs playwright (package.json already committed)
npx playwright install chromium
```

## Run (agent path)

1. Start the static file server (serves the whole `duriansystem/` dir so
   `dashboard/index.html` and `data/farm-data.json` are both reachable):

   ```bash
   python3 -m http.server 8743 --directory .
   ```

   Leave it running in the background. The driver defaults to port 8743
   (override with `DURIAN_PORT`).

2. Drive it from `duriansystem/`:

   ```bash
   # screenshot a view (default view, or pass a hash like #batches)
   node .claude/skills/run-durian-dashboard/driver.mjs shot out.png
   node .claude/skills/run-durian-dashboard/driver.mjs shot out.png "#batches"

   # click a selector, then screenshot the result
   node .claude/skills/run-durian-dashboard/driver.mjs click "a[data-view=batches]" out.png

   # run arbitrary JS in the page and print the JSON result
   node .claude/skills/run-durian-dashboard/driver.mjs eval "document.querySelector('#view').innerText.slice(0,200)"
   ```

   Sidebar nav selectors: `a[data-view=overview|batches|costs|wholesale|grades|merchants]`.

## Run (human path)

Open `dashboard/index.html` directly in Chrome (`open -a "Google Chrome" dashboard/index.html`
on macOS) — the "📂 连接数据文件" button needs Chrome's File System Access
API and only works when the page is opened this way or served over http(s),
not from other browsers.

## Gotchas

- **App state is not in `window` or readable via `localStorage` on a
  fresh page.** `app.js` declares `let DATA` at top level in a classic
  (non-module) script — top-level `let`/`const` does NOT attach to
  `window` (only `var` would), so `window.DATA` is `undefined`. And
  `localStorage["durianFarmData"]` is only written by `saveData()`,
  which only runs after an edit — a freshly loaded page has nothing in
  localStorage yet (it's rendering from in-memory `SEED_DATA` or a prior
  session's storage). To inspect rendered numbers, read the DOM
  (`document.querySelector('#view').innerText`) instead of reaching into
  JS state.
- **Opening `index.html` via `file://` works for layout but `fetch`/the
  File System Access connect button behave differently than over http.**
  The driver serves over `http://127.0.0.1:8743` via `python -m http.server`
  to match how an agent would actually exercise the page; this also avoids
  any `file://` CORS quirks if the app ever fetches relative JSON.
- **No npm/package.json at the app root.** Playwright is installed inside
  the skill directory (`.claude/skills/run-durian-dashboard/node_modules`),
  not at `duriansystem/` root, since the app itself has no Node tooling.

## Troubleshooting

- **`Cannot find module 'playwright'`**: you ran `node driver.mjs` without
  first running `npm install` inside `.claude/skills/run-durian-dashboard/`.
- **Screenshot shows a blank/white page**: the server isn't running on the
  expected port, or `DURIAN_PORT` doesn't match the `python -m http.server`
  port you started. Check with `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8743/dashboard/index.html`.
