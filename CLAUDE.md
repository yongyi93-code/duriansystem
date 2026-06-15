# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

榴莲庄经营追踪系统 — a single-investor durian farm (planting + wholesale) tracking system for a beginner owner. It has two halves that share one data file:

1. **Local web dashboard** (`dashboard/`) — vanilla JS, no build step, opened directly in Chrome.
2. **Five project-level subagents** (`.claude/agents/`) — an AI "team" (PA / admin / accountant / finance / marketing) that reads the same data and answers the owner in Chinese.

The whole system solves one pain point: durian spoilage is spread across stages (farm bad-fruit, transit bad-fruit, merchant rejection), so naive accounting overstates profit. Everything is computed against **真实可售量 (real sellable quantity)**, not harvest quantity.

## Running it

No build, no tests, no package manager. To launch the dashboard:

```
open -a "Google Chrome" dashboard/index.html
```

Chrome is required for the "连接数据文件" feature (File System Access API). Other browsers fall back to manual 导入/导出 JSON.

## Data is the single source of truth

`data/farm-data.json` is the ONE source of truth shared by the dashboard and all agents. Top-level keys: `meta`, `fixedCosts`, `priceTargets`, `batches`, `orders`, `merchants`.

- The dashboard keeps `localStorage["durianFarmData"]` as primary store and, once the user clicks **📂 连接数据文件** and picks `data/farm-data.json`, mirrors every change back to that file via a retained file handle (`saveData()` in `dashboard/app.js`). This is the only way agents see live edits.
- Agents (and you) may edit `data/farm-data.json` directly. After editing, tell the user to re-click **连接数据文件** (or refresh) so the dashboard reloads — the dashboard does not watch the file.
- New IDs follow `B-YYYYMMDD-NN` (batches) and `O-YYYYMMDD-NN` (orders).
- `data/backups/` holds timestamped JSON snapshots; the admin agent creates these.

## The core calculation contract (灵魂公式)

This must stay consistent across `dashboard/app.js` (the `calc` object), all five agent prompts, and `使用说明.md`. If you change one, change all.

```
好果 (good fruit)      = harvestWeightKg − farmSpoilageKg        (also = grades.A + B + C)
真实可售量 (sellable)  = 好果 − transitSpoilageKg − rejectedKg   (the latter two come from ORDERS)
真实总成本             = variableCosts + fixed-cost share
固定成本分摊           = month fixed total × (this batch harvest kg ÷ all batches' harvest kg that month)
真实单位成本           = 真实总成本 ÷ 真实可售量    ← denominator is SELLABLE qty, never harvest qty
某环节损耗金额         = 该环节损耗量(kg) × 真实单位成本
净利                  = amountReceived − 真实总成本
```

Two口径 rules that are easy to get wrong:

- **Loss in money = bad fruit × real unit cost.** Spoilage is valued at the real unit cost, not market price.
- **Grade (A/B/C) affects revenue only, never cost.** All fruit from one batch shares cost (same tree, same fertilizer). Higher A-share and selling closer to `priceTargets` is the biggest profit lever — this is why there is a dedicated 等级与定价 view and `gradeUpside`/`belowTargetOrders` calcs.

When an order references multiple `batchIds`, both loss and revenue are split across batches by each batch's harvest weight (`calc._batchShareInOrder`).

## Dashboard architecture (`dashboard/app.js`, single ~1500-line file)

Logical sections, in order, marked by numbered comment banners:

1. **SEED_DATA** — sample data used only when localStorage is empty.
2. **`calc` object** — all business logic as pure functions taking `(data, batch/order)`. This is where every number on the screen comes from; read it before changing any displayed figure. Key fns: `goodKg`, `sellableKg`, `realUnitCost`, `realTotalCost`, `batchPnL`, `summary`, `lossBreakdown`, `gradeMix`, `byGrade`, `targetPrice`, `belowTargetOrders`, `gradeUpside`, `fixedShareForBatch`.
3. **Persistence** — `loadData`/`saveData`/`connectFile`; localStorage primary + File System Access mirror.
4. **Render functions** — one `renderXxx(root)` per sidebar view (`overview`, `batches`, `costs`, `wholesale`, `grades`, `merchants`); `renderAll()` dispatches on the hash route. Charts use the vendored `dashboard/vendor/chart.umd.js` (no CDN); `destroyCharts()` must run before re-render to avoid leaks.

Views are hash-routed (`#overview` etc.) via the sidebar `data-view` links. Modals render into `#modal`.

## The five agents (`.claude/agents/durian-*.md`)

All are Chinese-speaking, all Read `data/farm-data.json` before answering, all must obey the calculation contract above. Routing:

- **durian-pa** — daily entry point; turns the owner's casual speech into batch/order records, writes daily/weekly reports, routes complex questions to the right specialist. Start here when unsure.
- **durian-accountant** — real cost, per-batch P&L, loss accounting, AR, monthly close. May run `node` for the formulas.
- **durian-finance** — "did I actually make money", pricing, grade strategy, cash flow, risk.
- **durian-marketing** — B2B wholesaler outreach, tiered quotes, 小红书/抖音/FB content.
- **durian-admin** — data QA, merchant records, backups.

When editing agent prompts, keep field-meaning glossaries and the formula口径 in sync with `app.js` and `使用说明.md`.

## Conventions

- All user-facing text is bilingual zh/en with Chinese primary (e.g. `"猫山王 Musang King"`). Currency is MYR via `meta.currency`.
- Unknown numbers are entered as `0` and filled in later — code must treat `0`/missing fields defensively (`Number(x) || 0`).
- Old batches may lack `grades`; calc treats them as ungraded — preserve this fallback.
