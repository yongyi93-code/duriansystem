/* =====================================================================
   榴莲庄经营追踪系统  Durian Farm Tracker
   app.js — 数据模型 + 计算层（纯函数）+ 界面渲染 + 读写
   ---------------------------------------------------------------------
   设计灵魂：用「真实可售量」而不是「采收量」做分母算成本，
   把分散在各环节的损耗换算成真实亏的钱。见 calc.* 纯函数。
   ===================================================================== */

/* ---------- 0. 首次运行的示例数据（localStorage 为空时用） ---------- */
const SEED_DATA = {
  meta: { farmName: "我的榴莲庄 My Durian Farm", currency: "MYR", updatedAt: new Date().toISOString() },
  fixedCosts: [
    { id: "F-rent", type: "land_rent", label: "土地租金 Land Rent", amountPerMonth: 3000, startDate: "2026-01-01", note: "" },
    { id: "F-dep", type: "depreciation", label: "树苗/设备折旧 Depreciation", amountPerMonth: 1200, startDate: "2026-01-01", note: "" }
  ],
  priceTargets: [
    { variety: "猫山王 Musang King", grade: "A", targetPrice: 60 },
    { variety: "猫山王 Musang King", grade: "B", targetPrice: 38 },
    { variety: "猫山王 Musang King", grade: "C", targetPrice: 20 },
    { variety: "黑刺 Black Thorn", grade: "A", targetPrice: 50 },
    { variety: "黑刺 Black Thorn", grade: "B", targetPrice: 32 },
    { variety: "黑刺 Black Thorn", grade: "C", targetPrice: 18 },
    { variety: "D24", grade: "A", targetPrice: 25 },
    { variety: "D24", grade: "B", targetPrice: 16 },
    { variety: "D24", grade: "C", targetPrice: 10 }
  ],
  batches: [
    { id: "B-20260601-01", date: "2026-06-01", variety: "猫山王 Musang King", plot: "A区", harvestCount: 320, harvestWeightKg: 640, farmSpoilageKg: 35,
      grades: { A: 300, B: 220, C: 85 }, treeAge: "old", harvestMethod: "drop", pulpYieldPct: 28, avgFruitWeightKg: 0,
      variableCosts: { labor: 800, fertilizer: 450, pesticide: 200, utilities: 120, packaging: 180, transport: 300 }, note: "" },
    { id: "B-20260605-01", date: "2026-06-05", variety: "黑刺 Black Thorn", plot: "B区", harvestCount: 180, harvestWeightKg: 396, farmSpoilageKg: 12,
      grades: { A: 200, B: 140, C: 44 }, treeAge: "mature", harvestMethod: "drop", pulpYieldPct: 25, avgFruitWeightKg: 2.2,
      variableCosts: { labor: 500, fertilizer: 260, pesticide: 120, utilities: 80, packaging: 110, transport: 220 }, note: "" }
  ],
  orders: [
    { id: "O-20260603-01", date: "2026-06-03", merchant: "M-aaa", batchIds: ["B-20260601-01"], grade: "B", weightKg: 400, unitPrice: 38, transitSpoilageKg: 45, rejectedKg: 20, amountBilled: 15200, amountReceived: 12730, paymentStatus: "partial", note: "" },
    { id: "O-20260606-01", date: "2026-06-06", merchant: "M-bbb", batchIds: ["B-20260601-01"], grade: "A", weightKg: 160, unitPrice: 40, transitSpoilageKg: 8, rejectedKg: 0, amountBilled: 6400, amountReceived: 6400, paymentStatus: "paid", note: "" },
    { id: "O-20260607-01", date: "2026-06-07", merchant: "M-bbb", batchIds: ["B-20260605-01"], grade: "B", weightKg: 380, unitPrice: 30, transitSpoilageKg: 10, rejectedKg: 5, amountBilled: 11400, amountReceived: 0, paymentStatus: "unpaid", note: "" }
  ],
  merchants: [
    { id: "M-aaa", name: "城南水果批发行 City South Fruit", contact: "陈老板 012-3456789", terms: "月结30天", note: "" },
    { id: "M-bbb", name: "本地生鲜店 Local Grocer", contact: "Lim 016-9988776", terms: "货到付款/7天", note: "" }
  ]
};
const GRADE_KEYS = ["A", "B", "C"];
const TREE_AGE_LABELS = { old: "老树 Old", mature: "成树 Mature", young: "幼树 Young", "": "—" };
const HARVEST_LABELS = { drop: "自然掉落 Drop", cut: "砍果 Cut", "": "—" };

/* ===================================================================
   1. 计算层 —— 纯函数（不碰界面，方便用 console 或 AI 复核）
   =================================================================== */
const calc = {
  sum: (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0),
  ym: (dateStr) => (dateStr || "").slice(0, 7), // "2026-06"

  // 一个批次的变动成本合计
  variableCostTotal(batch) { return calc.sum(batch.variableCosts); },

  // 当月固定成本总额（按 startDate 之后算作生效）
  monthlyFixedTotal(data, ym) {
    return data.fixedCosts.reduce((acc, f) => {
      if (!f.startDate || calc.ym(f.startDate) <= ym) return acc + (Number(f.amountPerMonth) || 0);
      return acc;
    }, 0);
  },

  // 固定成本按「同月各批次采收重量」比例分摊到某批次
  fixedShareForBatch(data, batch) {
    const ym = calc.ym(batch.date);
    const sameMonth = data.batches.filter(b => calc.ym(b.date) === ym);
    const totalWeight = sameMonth.reduce((a, b) => a + (Number(b.harvestWeightKg) || 0), 0);
    if (totalWeight <= 0) return 0;
    const monthFixed = calc.monthlyFixedTotal(data, ym);
    return monthFixed * ((Number(batch.harvestWeightKg) || 0) / totalWeight);
  },

  // 订单里某批次占的比例（订单可能关联多个批次，按采收重量分）
  _batchShareInOrder(data, order, batchId) {
    const ids = order.batchIds && order.batchIds.length ? order.batchIds : [];
    if (!ids.includes(batchId)) return 0;
    const weights = ids.map(id => {
      const b = data.batches.find(x => x.id === id);
      return b ? (Number(b.harvestWeightKg) || 0) : 0;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return ids.length ? 1 / ids.length : 0;
    const b = data.batches.find(x => x.id === batchId);
    return (b ? (Number(b.harvestWeightKg) || 0) : 0) / total;
  },

  // 分摊到批次的运输损耗 / 商家拒收（kg）
  batchTransitSpoilage(data, batch) {
    return data.orders.reduce((acc, o) =>
      acc + (Number(o.transitSpoilageKg) || 0) * calc._batchShareInOrder(data, o, batch.id), 0);
  },
  batchRejected(data, batch) {
    return data.orders.reduce((acc, o) =>
      acc + (Number(o.rejectedKg) || 0) * calc._batchShareInOrder(data, o, batch.id), 0);
  },

  // 本批好果按等级拆分(kg)；无 grades 时回退：把(采收−坏果)当未分级，全记到 A
  batchGradeKg(batch) {
    const g = batch.grades;
    if (g && (Number(g.A) || Number(g.B) || Number(g.C))) {
      return { A: Number(g.A) || 0, B: Number(g.B) || 0, C: Number(g.C) || 0, hasGrades: true };
    }
    const good = Math.max(0, (Number(batch.harvestWeightKg) || 0) - (Number(batch.farmSpoilageKg) || 0));
    return { A: good, B: 0, C: 0, hasGrades: false };
  },

  // 本批好果总量（= A+B+C；等于 采收 − 园区坏果）
  goodKg(batch) {
    const g = calc.batchGradeKg(batch);
    return g.A + g.B + g.C;
  },

  // 真实可售量 = 好果(A+B+C) − 运输坏果 − 商家拒收
  sellableKg(data, batch) {
    const v = calc.goodKg(batch)
      - calc.batchTransitSpoilage(data, batch)
      - calc.batchRejected(data, batch);
    return Math.max(0, v);
  },

  // 真实总成本 = 变动成本 + 固定成本分摊
  realTotalCost(data, batch) {
    return calc.variableCostTotal(batch) + calc.fixedShareForBatch(data, batch);
  },

  // 真实单位成本 = 真实总成本 / 真实可售量
  realUnitCost(data, batch) {
    const s = calc.sellableKg(data, batch);
    return s > 0 ? calc.realTotalCost(data, batch) / s : 0;
  },

  // 批次实收收入（按批次在订单中的占比）
  batchRevenue(data, batch) {
    return data.orders.reduce((acc, o) =>
      acc + (Number(o.amountReceived) || 0) * calc._batchShareInOrder(data, o, batch.id), 0);
  },

  // 批次盈亏 = 实收收入 − 真实总成本
  batchPnL(data, batch) {
    return calc.batchRevenue(data, batch) - calc.realTotalCost(data, batch);
  },

  // 全场损耗拆解（kg + 换算成的亏损金额）
  lossBreakdown(data) {
    let farmKg = 0, transitKg = 0, rejectKg = 0, farm$ = 0, transit$ = 0, reject$ = 0;
    data.batches.forEach(b => {
      const unit = calc.realUnitCost(data, b);
      const f = Number(b.farmSpoilageKg) || 0;
      const t = calc.batchTransitSpoilage(data, b);
      const r = calc.batchRejected(data, b);
      farmKg += f; transitKg += t; rejectKg += r;
      farm$ += f * unit; transit$ += t * unit; reject$ += r * unit;
    });
    const totalHarvest = data.batches.reduce((a, b) => a + (Number(b.harvestWeightKg) || 0), 0);
    const totalLossKg = farmKg + transitKg + rejectKg;
    return {
      farmKg, transitKg, rejectKg, totalLossKg,
      farmAmt: farm$, transitAmt: transit$, rejectAmt: reject$, totalLossAmt: farm$ + transit$ + reject$,
      totalHarvest,
      lossRate: totalHarvest > 0 ? totalLossKg / totalHarvest : 0,
      transitRate: totalHarvest > 0 ? transitKg / totalHarvest : 0,
      farmRate: totalHarvest > 0 ? farmKg / totalHarvest : 0,
      rejectRate: totalHarvest > 0 ? rejectKg / totalHarvest : 0
    };
  },

  // 全场汇总（可传 period: 'month'|'year'|'all'，基于 refDate）
  summary(data, period = "all", refDate = new Date()) {
    const inPeriod = (dateStr) => {
      if (period === "all") return true;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (period === "month") return d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth();
      if (period === "year") return d.getFullYear() === refDate.getFullYear();
      return true;
    };
    const batches = data.batches.filter(b => inPeriod(b.date));
    const orders = data.orders.filter(o => inPeriod(o.date));
    const revenue = orders.reduce((a, o) => a + (Number(o.amountReceived) || 0), 0);
    const billed = orders.reduce((a, o) => a + (Number(o.amountBilled) || 0), 0);
    const cost = batches.reduce((a, b) => a + calc.realTotalCost(data, b), 0);
    const netProfit = revenue - cost;
    const ar = data.orders.reduce((a, o) => a + ((Number(o.amountBilled) || 0) - (Number(o.amountReceived) || 0)), 0);
    return {
      revenue, billed, cost, netProfit,
      netMargin: revenue > 0 ? netProfit / revenue : 0,
      accountsReceivable: ar
    };
  },

  // 月度时间序列（给折线图）
  monthlySeries(data) {
    const map = {};
    const touch = (ym) => { if (!map[ym]) map[ym] = { ym, revenue: 0, cost: 0 }; return map[ym]; };
    data.orders.forEach(o => { if (o.date) touch(calc.ym(o.date)).revenue += Number(o.amountReceived) || 0; });
    data.batches.forEach(b => { if (b.date) touch(calc.ym(b.date)).cost += calc.realTotalCost(data, b); });
    return Object.values(map).sort((a, b) => a.ym.localeCompare(b.ym))
      .map(m => ({ ...m, profit: m.revenue - m.cost }));
  },

  // 按品种利润（给柱状图）
  profitByVariety(data) {
    const map = {};
    data.batches.forEach(b => {
      const k = b.variety || "未分类";
      map[k] = (map[k] || 0) + calc.batchPnL(data, b);
    });
    return Object.entries(map).map(([variety, profit]) => ({ variety, profit }));
  },

  // 按商家
  byMerchant(data) {
    const map = {};
    data.orders.forEach(o => {
      const m = data.merchants.find(x => x.id === o.merchant);
      const name = m ? m.name : (o.merchant || "未知");
      if (!map[name]) map[name] = { name, weightKg: 0, received: 0, billed: 0, ar: 0 };
      map[name].weightKg += Number(o.weightKg) || 0;
      map[name].received += Number(o.amountReceived) || 0;
      map[name].billed += Number(o.amountBilled) || 0;
      map[name].ar += (Number(o.amountBilled) || 0) - (Number(o.amountReceived) || 0);
    });
    return Object.values(map);
  },

  /* ---------- 等级与定价 Grades & Pricing ---------- */

  // 全场等级构成（A/B/C 总 kg 与占比）
  gradeMix(data) {
    const kg = { A: 0, B: 0, C: 0 };
    data.batches.forEach(b => {
      const g = calc.batchGradeKg(b);
      kg.A += g.A; kg.B += g.B; kg.C += g.C;
    });
    const total = kg.A + kg.B + kg.C;
    return {
      kg, total,
      pct: {
        A: total > 0 ? kg.A / total : 0,
        B: total > 0 ? kg.B / total : 0,
        C: total > 0 ? kg.C / total : 0
      }
    };
  },

  // 查目标价（品种 × 等级）
  targetPrice(data, variety, grade) {
    const t = (data.priceTargets || []).find(p => p.variety === variety && p.grade === grade);
    return t ? (Number(t.targetPrice) || 0) : 0;
  },

  // 某订单关联批次的主品种（取占比最大的批次品种）
  orderVariety(data, order) {
    const ids = order.batchIds || [];
    if (!ids.length) return "";
    const b = data.batches.find(x => x.id === ids[0]);
    return b ? b.variety : "";
  },

  // 按等级汇总：销量(kg)、成交均价(按开票单价加权)、实收、目标均价、与目标价差额金额
  byGrade(data) {
    const map = {};
    GRADE_KEYS.forEach(g => map[g] = { grade: g, weightKg: 0, billed: 0, received: 0, targetSum: 0 });
    data.orders.forEach(o => {
      const g = (o.grade && GRADE_KEYS.includes(o.grade)) ? o.grade : "B";
      const w = Number(o.weightKg) || 0;
      if (!map[g]) map[g] = { grade: g, weightKg: 0, billed: 0, received: 0, targetSum: 0 };
      map[g].weightKg += w;
      map[g].billed += (Number(o.unitPrice) || 0) * w;       // 成交额(按单价) = 议定价×重量
      map[g].received += Number(o.amountReceived) || 0;
      map[g].targetSum += calc.targetPrice(data, calc.orderVariety(data, o), g) * w;
    });
    return GRADE_KEYS.map(g => {
      const m = map[g];
      const avg = m.weightKg > 0 ? m.billed / m.weightKg : 0;        // 成交均价
      const targetAvg = m.weightKg > 0 ? m.targetSum / m.weightKg : 0; // 目标均价
      return { ...m, avgPrice: avg, targetAvg, gapAmt: m.billed - m.targetSum };
    });
  },

  // 卖价低于目标价的订单（预警 + 少赚金额）
  belowTargetOrders(data) {
    const out = [];
    data.orders.forEach(o => {
      const g = o.grade && GRADE_KEYS.includes(o.grade) ? o.grade : null;
      if (!g) return;
      const variety = calc.orderVariety(data, o);
      const target = calc.targetPrice(data, variety, g);
      const price = Number(o.unitPrice) || 0;
      if (target > 0 && price > 0 && price < target) {
        const w = Number(o.weightKg) || 0;
        out.push({ id: o.id, date: o.date, variety, grade: g, price, target, weightKg: w, shortfall: (target - price) * w });
      }
    });
    return out.sort((a, b) => b.shortfall - a.shortfall);
  },

  // 升级空间：① 已卖订单达到目标价能多赚；② 库存里 A 级若都按目标价卖的潜在价值
  gradeUpside(data) {
    const below = calc.belowTargetOrders(data);
    const pricingUpside = below.reduce((a, o) => a + o.shortfall, 0);
    const mix = calc.gradeMix(data);
    return {
      pricingUpside,                // 把低于目标价的订单提到目标价，可多赚
      belowCount: below.length,
      gradeAPct: mix.pct.A,
      gradeBPct: mix.pct.B,
      gradeCPct: mix.pct.C
    };
  }
};

/* ===================================================================
   2. 状态 + 持久化（localStorage 主存 + File System Access 同步到 json）
   =================================================================== */
const LS_KEY = "durianFarmData";
let DATA = null;
let fileHandle = null; // 连接的 data/farm-data.json 句柄（用于让 AI 团队读到最新数据）

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("读取本地存储失败", e); }
  return JSON.parse(JSON.stringify(SEED_DATA));
}

async function saveData() {
  DATA.meta.updatedAt = new Date().toISOString();
  try { localStorage.setItem(LS_KEY, JSON.stringify(DATA)); } catch (e) { console.warn(e); }
  if (fileHandle) {
    try {
      const w = await fileHandle.createWritable();
      await w.write(JSON.stringify(DATA, null, 2));
      await w.close();
      setFileStatus("已同步到 data/farm-data.json ✓ AI 团队可读最新数据");
    } catch (e) {
      console.warn("写文件失败", e);
      setFileStatus("⚠️ 写入数据文件失败，已存浏览器。可重新连接文件。");
    }
  }
}

function setFileStatus(msg) {
  const el = document.getElementById("fileStatus");
  if (el) el.textContent = msg;
}

// 连接 data/farm-data.json：读它为数据源 + 保留句柄自动回写
async function connectFile() {
  if (!window.showOpenFilePicker) {
    alert("当前浏览器不支持直接连接文件。请改用 Chrome 打开本页面；或用「导入/导出 JSON」按钮手动同步。");
    return;
  }
  try {
    const [h] = await window.showOpenFilePicker({
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: false, multiple: false
    });
    fileHandle = h;
    const file = await h.getFile();
    const text = await file.text();
    if (text.trim()) {
      DATA = JSON.parse(text);
      localStorage.setItem(LS_KEY, JSON.stringify(DATA));
      renderAll();
    }
    setFileStatus("已连接 " + h.name + " ✓ 之后每次修改自动写回，AI 团队即时可读");
  } catch (e) {
    if (e.name !== "AbortError") { console.warn(e); alert("连接文件失败：" + e.message); }
  }
}

/* ===================================================================
   3. 小工具
   =================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const cur = () => (DATA && DATA.meta && DATA.meta.currency) || "MYR";
const fmtMoney = (n) => cur() + " " + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtKg = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString() + " kg";
const fmtPct = (n) => (Number(n) * 100).toFixed(1) + "%";
const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ===================================================================
   4. 视图渲染
   =================================================================== */
let charts = {};
function destroyCharts() { Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} }); charts = {}; }

function renderAll() {
  const view = (location.hash || "#overview").slice(1);
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
  destroyCharts();
  const root = $("#view");
  ({
    overview: renderOverview,
    batches: renderBatches,
    costs: renderCosts,
    wholesale: renderWholesale,
    grades: renderGrades,
    merchants: renderMerchants
  }[view] || renderOverview)(root);
}

/* ---------- 4.1 总览 Overview ---------- */
function renderOverview(root) {
  const sMonth = calc.summary(DATA, "month");
  const sAll = calc.summary(DATA, "all");
  const loss = calc.lossBreakdown(DATA);
  const mix = calc.gradeMix(DATA);
  const card = (label, val, sub, cls = "") =>
    `<div class="card ${cls}"><div class="card-label">${label}</div><div class="card-val">${val}</div><div class="card-sub">${sub || ""}</div></div>`;

  root.innerHTML = `
    <h2>总览 Overview</h2>
    <div class="cards">
      ${card("总收入 Revenue（累计）", fmtMoney(sAll.revenue), "本月 " + fmtMoney(sMonth.revenue))}
      ${card("真实成本 Real Cost（累计）", fmtMoney(sAll.cost), "本月 " + fmtMoney(sMonth.cost))}
      ${card("净利 Net Profit（累计）", fmtMoney(sAll.netProfit), "净利率 " + fmtPct(sAll.netMargin), sAll.netProfit >= 0 ? "good" : "bad")}
      ${card("总损耗率 Loss Rate", fmtPct(loss.lossRate), "亏损金额 " + fmtMoney(loss.totalLossAmt), loss.lossRate > 0.08 ? "bad" : "")}
      ${card("A 级占比 Grade A %", fmtPct(mix.pct.A), `B ${fmtPct(mix.pct.B)} · C ${fmtPct(mix.pct.C)}`, mix.pct.A < 0.4 ? "warn" : "good")}
      ${card("应收账款 AR（未回款）", fmtMoney(sAll.accountsReceivable), "记得催收", sAll.accountsReceivable > 0 ? "warn" : "")}
    </div>

    ${renderAlerts(loss, sAll)}

    <div class="charts">
      <div class="chart-box"><h3>月度收入/成本/利润 Monthly</h3><canvas id="cMonthly"></canvas></div>
      <div class="chart-box"><h3>损耗按环节 Loss by Stage（金额）</h3><canvas id="cLoss"></canvas></div>
      <div class="chart-box"><h3>各品种利润 Profit by Variety</h3><canvas id="cVariety"></canvas></div>
    </div>
  `;
  drawMonthly(); drawLoss(loss); drawVariety();
}

function renderAlerts(loss, s) {
  const msgs = [];
  if (loss.transitRate > 0.08) msgs.push(`🚚 运输损耗 ${fmtPct(loss.transitRate)} 偏高（约 ${fmtMoney(loss.transitAmt)}）——考虑换冷链/缩短运距/挑近距离商家。`);
  if (loss.farmRate > 0.06) msgs.push(`🌳 园区坏果 ${fmtPct(loss.farmRate)} 偏高（约 ${fmtMoney(loss.farmAmt)}）——检查采收时机与防裂果。`);
  if (loss.rejectRate > 0.03) msgs.push(`📦 商家拒收 ${fmtPct(loss.rejectRate)}（约 ${fmtMoney(loss.rejectAmt)}）——和拒收多的商家谈验收标准。`);
  if (s.netMargin < 0.15 && s.revenue > 0) msgs.push(`📉 净利率仅 ${fmtPct(s.netMargin)}——找财务 AI 看定价与降损耗空间。`);
  if (s.accountsReceivable > 0) msgs.push(`💰 有 ${fmtMoney(s.accountsReceivable)} 未回款——找会计 AI 列催收清单。`);
  const up = calc.gradeUpside(DATA);
  if (up.belowCount > 0) msgs.push(`🏅 有 ${up.belowCount} 单卖价低于目标价，少赚约 ${fmtMoney(up.pricingUpside)}——去「等级与定价」页看明细。`);
  if (up.gradeAPct < 0.4 && (up.gradeAPct + up.gradeBPct + up.gradeCPct) > 0) msgs.push(`📈 A 级仅占 ${fmtPct(up.gradeAPct)}——提升 A 级占比是提利润的最大杠杆，找财务 AI 看怎么做。`);
  if (!msgs.length) return `<div class="alerts ok">✅ 暂无重大预警，继续保持！</div>`;
  return `<div class="alerts"><strong>⚠️ 经营预警 Alerts</strong><ul>${msgs.map(m => `<li>${m}</li>`).join("")}</ul></div>`;
}

/* ---------- 4.2 采收批次 Harvest Batches ---------- */
function renderBatches(root) {
  const rows = DATA.batches.map(b => {
    const sell = calc.sellableKg(DATA, b);
    const unit = calc.realUnitCost(DATA, b);
    const pnl = calc.batchPnL(DATA, b);
    const g = calc.batchGradeKg(b);
    const gradeCell = g.hasGrades
      ? `<span class="pos">A ${Math.round(g.A)}</span> / B ${Math.round(g.B)} / <span class="muted">C ${Math.round(g.C)}</span>`
      : `<span class="muted">未分级</span>`;
    const tags = [TREE_AGE_LABELS[b.treeAge || ""], HARVEST_LABELS[b.harvestMethod || ""]].filter(x => x && x !== "—").join(" · ");
    return `<tr>
      <td>${esc(b.id)}</td><td>${esc(b.date)}</td>
      <td>${esc(b.variety)}${tags ? `<br><span class="muted">${tags}</span>` : ""}</td>
      <td>${fmtKg(b.harvestWeightKg)}<br><span class="muted">${b.harvestCount || 0} 颗</span></td>
      <td>${gradeCell}</td>
      <td>${fmtKg(sell)}</td>
      <td>${fmtMoney(unit)}/kg</td>
      <td class="${pnl >= 0 ? 'pos' : 'neg'}">${fmtMoney(pnl)}</td>
      <td><button class="link" onclick="editBatch('${b.id}')">改</button> <button class="link danger" onclick="delItem('batches','${b.id}')">删</button></td>
    </tr>`;
  }).join("");

  root.innerHTML = `
    <h2>采收批次 Harvest Batches</h2>
    <p class="muted">每次采收记一批，并把好果分成 A/B/C 级（一棵树的果通常混级）。真实可售量 = (A+B+C) − 运输坏果 − 商家拒收；单位成本 = 真实成本 ÷ 真实可售量（成本整批共享，与等级无关）。</p>
    <button class="btn" onclick="editBatch()">+ 新增批次 New Batch</button>
    <table class="tbl">
      <thead><tr><th>批次 ID</th><th>日期</th><th>品种 / 树龄·采收</th><th>采收量</th><th>等级 A/B/C (kg)</th><th>真实可售</th><th>单位成本</th><th>批次盈亏</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">还没有批次，点上面新增。</td></tr>`}</tbody>
    </table>
  `;
}

window.editBatch = function (id) {
  const b = id ? DATA.batches.find(x => x.id === id) : null;
  const v = b ? b.variableCosts : {};
  const gr = b && b.grades ? b.grades : {};
  const f = (k, def = "") => b ? (b[k] ?? def) : def;
  const sel = (val, opt) => val === opt ? "selected" : "";
  formModal(`${b ? "编辑" : "新增"}采收批次 Batch`, `
    ${field("date", "采收日期 Date", "date", b ? b.date : new Date().toISOString().slice(0, 10))}
    ${field("variety", "品种 Variety", "text", f("variety"), "如 猫山王 Musang King / 黑刺 Black Thorn")}
    ${field("plot", "地块 Plot", "text", f("plot"), "如 A区")}
    ${field("harvestCount", "采收数量(颗) Count", "number", f("harvestCount", 0), "不确定填 0")}
    ${field("harvestWeightKg", "采收重量(kg) Weight", "number", f("harvestWeightKg", 0), "总重，不确定填 0")}
    ${field("farmSpoilageKg", "园区坏果(kg) Farm Spoilage", "number", f("farmSpoilageKg", 0), "裂果/烂果，不确定填 0")}
    <fieldset><legend>等级拆分 Grades（好果分级，A+B+C 应 ≈ 采收−坏果）</legend>
      ${field("gradeA", "A 级(kg) — 大果/出肉率高/卖相好", "number", gr.A || 0, "最值钱")}
      ${field("gradeB", "B 级(kg) — 偏小/出肉率一般", "number", gr.B || 0)}
      ${field("gradeC", "C 级(kg) — 次果/走加工", "number", gr.C || 0)}
    </fieldset>
    <fieldset><legend>品质属性 Quality（影响卖价，可留默认）</legend>
      <label class="fld"><span>树龄 Tree Age</span>
        <select id="fld_treeAge">
          <option value="" ${sel(f("treeAge"), "")}>—</option>
          <option value="old" ${sel(f("treeAge"), "old")}>老树 Old（更值钱）</option>
          <option value="mature" ${sel(f("treeAge"), "mature")}>成树 Mature</option>
          <option value="young" ${sel(f("treeAge"), "young")}>幼树 Young</option>
        </select></label>
      <label class="fld"><span>采收方式 Harvest Method</span>
        <select id="fld_harvestMethod">
          <option value="" ${sel(f("harvestMethod"), "")}>—</option>
          <option value="drop" ${sel(f("harvestMethod"), "drop")}>自然掉落 Drop（树熟，更值钱）</option>
          <option value="cut" ${sel(f("harvestMethod"), "cut")}>砍果 Cut</option>
        </select></label>
      ${field("pulpYieldPct", "出肉率(%) Pulp Yield", "number", f("pulpYieldPct", 0), "如 28，不确定填 0")}
      ${field("avgFruitWeightKg", "平均单果重(kg) Avg Fruit Wt", "number", f("avgFruitWeightKg", 0), "留 0 自动按颗数算")}
    </fieldset>
    <fieldset><legend>变动成本 Variable Costs（这批花的钱，不确定填 0）</legend>
      ${field("labor", "人工 Labor", "number", v.labor || 0)}
      ${field("fertilizer", "肥料 Fertilizer", "number", v.fertilizer || 0)}
      ${field("pesticide", "农药 Pesticide", "number", v.pesticide || 0)}
      ${field("utilities", "水电 Utilities", "number", v.utilities || 0)}
      ${field("packaging", "包装 Packaging", "number", v.packaging || 0)}
      ${field("transport", "运输 Transport", "number", v.transport || 0)}
    </fieldset>
    ${field("note", "备注 Note", "text", f("note"))}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    const num = (n) => Number(g(n)) || 0;
    const rec = {
      id: b ? b.id : "B-" + (g("date").replace(/-/g, "")) + "-" + uid("").slice(-3),
      date: g("date"), variety: g("variety"), plot: g("plot"),
      harvestCount: num("harvestCount"), harvestWeightKg: num("harvestWeightKg"), farmSpoilageKg: num("farmSpoilageKg"),
      grades: { A: num("gradeA"), B: num("gradeB"), C: num("gradeC") },
      treeAge: g("treeAge"), harvestMethod: g("harvestMethod"),
      pulpYieldPct: num("pulpYieldPct"), avgFruitWeightKg: num("avgFruitWeightKg"),
      variableCosts: { labor: num("labor"), fertilizer: num("fertilizer"), pesticide: num("pesticide"), utilities: num("utilities"), packaging: num("packaging"), transport: num("transport") },
      note: g("note")
    };
    if (b) Object.assign(b, rec); else DATA.batches.push(rec);
    saveData(); closeModal(); renderAll();
  });
};

/* ---------- 4.3 成本 Costs ---------- */
function renderCosts(root) {
  const fixedRows = DATA.fixedCosts.map(f => `<tr>
      <td>${esc(f.label)}</td><td>${esc(f.type)}</td><td>${fmtMoney(f.amountPerMonth)}/月</td><td>${esc(f.startDate)}</td>
      <td><button class="link" onclick="editFixed('${f.id}')">改</button> <button class="link danger" onclick="delItem('fixedCosts','${f.id}')">删</button></td>
    </tr>`).join("");
  const varRows = DATA.batches.map(b => `<tr>
      <td>${esc(b.id)}</td><td>${esc(b.variety)}</td>
      <td>${fmtMoney(b.variableCosts.labor)}</td><td>${fmtMoney(b.variableCosts.fertilizer)}</td>
      <td>${fmtMoney(b.variableCosts.pesticide)}</td><td>${fmtMoney(b.variableCosts.utilities)}</td>
      <td>${fmtMoney(b.variableCosts.packaging)}</td><td>${fmtMoney(b.variableCosts.transport)}</td>
      <td><strong>${fmtMoney(calc.variableCostTotal(b))}</strong></td>
      <td>${fmtMoney(calc.fixedShareForBatch(DATA, b))}</td>
    </tr>`).join("");

  root.innerHTML = `
    <h2>成本 Costs</h2>
    <h3>固定成本 Fixed Costs（按月，自动按采收重量分摊到批次）</h3>
    <button class="btn" onclick="editFixed()">+ 新增固定成本</button>
    <table class="tbl"><thead><tr><th>名称</th><th>类型</th><th>金额</th><th>起始日</th><th></th></tr></thead>
      <tbody>${fixedRows || `<tr><td colspan="5" class="muted">无</td></tr>`}</tbody></table>
    <h3 style="margin-top:24px">各批次变动成本 Variable Costs（在「采收批次」里录入/编辑）</h3>
    <table class="tbl"><thead><tr><th>批次</th><th>品种</th><th>人工</th><th>肥料</th><th>农药</th><th>水电</th><th>包装</th><th>运输</th><th>变动合计</th><th>固定分摊</th></tr></thead>
      <tbody>${varRows || `<tr><td colspan="10" class="muted">无</td></tr>`}</tbody></table>
  `;
}

window.editFixed = function (id) {
  const f = id ? DATA.fixedCosts.find(x => x.id === id) : null;
  formModal(`${f ? "编辑" : "新增"}固定成本 Fixed Cost`, `
    ${field("label", "名称 Label", "text", f ? f.label : "", "如 土地租金 Land Rent")}
    <label class="fld"><span>类型 Type</span>
      <select id="fld_type">
        <option value="land_rent" ${f && f.type === 'land_rent' ? 'selected' : ''}>土地租金 Land Rent</option>
        <option value="depreciation" ${f && f.type === 'depreciation' ? 'selected' : ''}>折旧 Depreciation</option>
        <option value="other" ${f && f.type === 'other' ? 'selected' : ''}>其他 Other</option>
      </select></label>
    ${field("amountPerMonth", "每月金额 Per Month", "number", f ? f.amountPerMonth : 0)}
    ${field("startDate", "起始日期 Start", "date", f ? f.startDate : new Date().toISOString().slice(0, 10))}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    const rec = { id: f ? f.id : uid("F"), label: g("label"), type: g("type"), amountPerMonth: Number(g("amountPerMonth")) || 0, startDate: g("startDate"), note: "" };
    if (f) Object.assign(f, rec); else DATA.fixedCosts.push(rec);
    saveData(); closeModal(); renderAll();
  });
};

/* ---------- 4.4 批发与损耗 Wholesale & Loss ---------- */
function renderWholesale(root) {
  const loss = calc.lossBreakdown(DATA);
  const orderRows = DATA.orders.map(o => {
    const m = DATA.merchants.find(x => x.id === o.merchant);
    const ar = (Number(o.amountBilled) || 0) - (Number(o.amountReceived) || 0);
    const statusMap = { paid: "已回款", partial: "部分", unpaid: "未回款" };
    const gradeBadge = o.grade ? `<span class="grade-badge g${o.grade}">${o.grade}</span>` : "";
    const tgt = o.grade ? calc.targetPrice(DATA, calc.orderVariety(DATA, o), o.grade) : 0;
    const below = tgt > 0 && (Number(o.unitPrice) || 0) < tgt;
    return `<tr>
      <td>${esc(o.date)}</td><td>${m ? esc(m.name) : esc(o.merchant)}</td>
      <td>${gradeBadge}</td>
      <td>${esc((o.batchIds || []).join(", "))}</td>
      <td>${fmtKg(o.weightKg)} @ ${fmtMoney(o.unitPrice)}${below ? `<br><span class="neg">⚠ 低于目标 ${fmtMoney(tgt)}</span>` : ""}</td>
      <td>${fmtKg(o.transitSpoilageKg)}</td><td>${fmtKg(o.rejectedKg)}</td>
      <td>${fmtMoney(o.amountReceived)}<br><span class="muted">开票 ${fmtMoney(o.amountBilled)}</span></td>
      <td class="${ar > 0 ? 'neg' : ''}">${statusMap[o.paymentStatus] || o.paymentStatus}${ar > 0 ? "<br>欠 " + fmtMoney(ar) : ""}</td>
      <td><button class="link" onclick="editOrder('${o.id}')">改</button> <button class="link danger" onclick="delItem('orders','${o.id}')">删</button></td>
    </tr>`;
  }).join("");

  const lossCard = (label, kg, amt, rate, hi) =>
    `<div class="card ${hi ? 'bad' : ''}"><div class="card-label">${label}</div><div class="card-val">${fmtKg(kg)}</div><div class="card-sub">${fmtMoney(amt)} · ${fmtPct(rate)}</div></div>`;

  root.innerHTML = `
    <h2>批发与损耗 Wholesale & Loss</h2>
    <button class="btn" onclick="editOrder()">+ 新增批发订单 New Order</button>
    <table class="tbl">
      <thead><tr><th>日期</th><th>商家</th><th>等级</th><th>批次</th><th>数量@单价</th><th>运输坏果</th><th>商家拒收</th><th>实收/开票</th><th>回款</th><th></th></tr></thead>
      <tbody>${orderRows || `<tr><td colspan="10" class="muted">还没有订单。</td></tr>`}</tbody>
    </table>
    <h3 style="margin-top:24px">损耗分析 Loss Analysis（把坏掉的果换算成真实亏的钱）</h3>
    <div class="cards">
      ${lossCard("🌳 园区坏果 Farm", loss.farmKg, loss.farmAmt, loss.farmRate, loss.farmRate > 0.06)}
      ${lossCard("🚚 运输坏果 Transit", loss.transitKg, loss.transitAmt, loss.transitRate, loss.transitRate > 0.08)}
      ${lossCard("📦 商家拒收 Rejected", loss.rejectKg, loss.rejectAmt, loss.rejectRate, loss.rejectRate > 0.03)}
      ${lossCard("合计 Total Loss", loss.totalLossKg, loss.totalLossAmt, loss.lossRate, loss.lossRate > 0.1)}
    </div>
  `;
}

window.editOrder = function (id) {
  const o = id ? DATA.orders.find(x => x.id === id) : null;
  const merchOpts = DATA.merchants.map(m => `<option value="${m.id}" ${o && o.merchant === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join("");
  const batchOpts = DATA.batches.map(b => `<option value="${b.id}" ${o && (o.batchIds || []).includes(b.id) ? 'selected' : ''}>${esc(b.id)} (${esc(b.variety)})</option>`).join("");
  const f = (k, def = "") => o ? (o[k] ?? def) : def;
  formModal(`${o ? "编辑" : "新增"}批发订单 Order`, `
    ${field("date", "日期 Date", "date", o ? o.date : new Date().toISOString().slice(0, 10))}
    <label class="fld"><span>商家 Merchant</span><select id="fld_merchant">${merchOpts || '<option value="">先去「客户」加商家</option>'}</select></label>
    <label class="fld"><span>关联批次 Batches（可多选，按住 Ctrl/⌘）</span><select id="fld_batches" multiple size="3">${batchOpts}</select></label>
    <label class="fld"><span>等级 Grade（这单卖的是哪一级）</span>
      <select id="fld_grade">
        <option value="A" ${o && o.grade === 'A' ? 'selected' : ''}>A 级</option>
        <option value="B" ${o && o.grade === 'B' ? 'selected' : ''}>B 级</option>
        <option value="C" ${o && o.grade === 'C' ? 'selected' : ''}>C 级</option>
      </select></label>
    ${field("weightKg", "批发数量(kg) Weight", "number", f("weightKg", 0))}
    ${field("unitPrice", "单价 Unit Price", "number", f("unitPrice", 0))}
    <div id="targetHint" class="hint muted"></div>
    ${field("transitSpoilageKg", "运输途中坏果(kg) Transit Spoilage", "number", f("transitSpoilageKg", 0), "不确定填 0")}
    ${field("rejectedKg", "商家退货/拒收(kg) Rejected", "number", f("rejectedKg", 0), "不确定填 0")}
    ${field("amountBilled", "开票金额 Billed", "number", f("amountBilled", 0))}
    ${field("amountReceived", "实收金额 Received", "number", f("amountReceived", 0), "实际到账，未收填 0")}
    <label class="fld"><span>回款状态 Payment</span>
      <select id="fld_paymentStatus">
        <option value="unpaid" ${o && o.paymentStatus === 'unpaid' ? 'selected' : ''}>未回款 Unpaid</option>
        <option value="partial" ${o && o.paymentStatus === 'partial' ? 'selected' : ''}>部分 Partial</option>
        <option value="paid" ${o && o.paymentStatus === 'paid' ? 'selected' : ''}>已回款 Paid</option>
      </select></label>
    ${field("note", "备注 Note", "text", f("note"))}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    const num = (n) => Number(g(n)) || 0;
    const batchIds = $$("#fld_batches option").filter(opt => opt.selected).map(opt => opt.value);
    const rec = {
      id: o ? o.id : "O-" + g("date").replace(/-/g, "") + "-" + uid("").slice(-3),
      date: g("date"), merchant: g("merchant"), batchIds, grade: g("grade"),
      weightKg: num("weightKg"), unitPrice: num("unitPrice"),
      transitSpoilageKg: num("transitSpoilageKg"), rejectedKg: num("rejectedKg"),
      amountBilled: num("amountBilled"), amountReceived: num("amountReceived"),
      paymentStatus: g("paymentStatus"), note: g("note")
    };
    if (o) Object.assign(o, rec); else DATA.orders.push(rec);
    saveData(); closeModal(); renderAll();
  });
  // 目标价提示：选等级/批次/改单价时实时更新
  const updateHint = () => {
    const el = $("#targetHint"); if (!el) return;
    const grade = $("#fld_grade").value;
    const bid = ($$("#fld_batches option").filter(x => x.selected).map(x => x.value)[0]) || ($("#fld_batches") && $("#fld_batches").value);
    const bb = DATA.batches.find(x => x.id === bid);
    const variety = bb ? bb.variety : "";
    const tgt = calc.targetPrice(DATA, variety, grade);
    const price = Number($("#fld_unitPrice").value) || 0;
    if (!tgt) { el.textContent = variety ? `（${variety} ${grade} 级未设目标价，可在「等级与定价」页设）` : "选好批次后这里会显示目标价"; el.className = "hint muted"; return; }
    if (price > 0 && price < tgt) { el.innerHTML = `⚠ 目标价 ${fmtMoney(tgt)}/kg，你这单 ${fmtMoney(price)} <b>偏低</b>，每 kg 少卖 ${fmtMoney(tgt - price)}`; el.className = "hint warn-text"; }
    else { el.innerHTML = `🎯 目标价 ${fmtMoney(tgt)}/kg${price >= tgt ? "，达标 ✓" : ""}`; el.className = "hint ok-text"; }
  };
  ["fld_grade", "fld_batches", "fld_unitPrice"].forEach(idv => { const e = $("#" + idv); if (e) e.addEventListener("change", updateHint); if (e) e.addEventListener("input", updateHint); });
  updateHint();
};

/* ---------- 4.45 等级与定价 Grades & Pricing ---------- */
function renderGrades(root) {
  const mix = calc.gradeMix(DATA);
  const byG = calc.byGrade(DATA);
  const up = calc.gradeUpside(DATA);
  const below = calc.belowTargetOrders(DATA);
  const gName = { A: "A 级", B: "B 级", C: "C 级" };

  const mixCards = ["A", "B", "C"].map(g =>
    `<div class="card ${g === 'A' ? 'good' : ''}"><div class="card-label">${gName[g]} 库存占比</div>
      <div class="card-val">${fmtPct(mix.pct[g])}</div><div class="card-sub">${fmtKg(mix.kg[g])}</div></div>`).join("");

  const gradeRows = byG.map(g => `<tr>
      <td><span class="grade-badge g${g.grade}">${g.grade}</span> ${gName[g.grade]}</td>
      <td>${fmtKg(g.weightKg)}</td>
      <td>${g.avgPrice > 0 ? fmtMoney(g.avgPrice) + "/kg" : "—"}</td>
      <td>${g.targetAvg > 0 ? fmtMoney(g.targetAvg) + "/kg" : "—"}</td>
      <td class="${g.gapAmt < 0 ? 'neg' : 'pos'}">${g.weightKg > 0 ? fmtMoney(g.gapAmt) : "—"}</td>
    </tr>`).join("");

  const belowRows = below.map(o => `<tr>
      <td>${esc(o.id)}</td><td>${esc(o.variety)}</td><td><span class="grade-badge g${o.grade}">${o.grade}</span></td>
      <td>${fmtMoney(o.price)} → 目标 ${fmtMoney(o.target)}</td>
      <td>${fmtKg(o.weightKg)}</td><td class="neg">少赚 ${fmtMoney(o.shortfall)}</td>
    </tr>`).join("");

  const ptRows = (DATA.priceTargets || []).map((p, i) => `<tr>
      <td>${esc(p.variety)}</td><td><span class="grade-badge g${p.grade}">${p.grade}</span></td>
      <td>${fmtMoney(p.targetPrice)}/kg</td>
      <td><button class="link" onclick="editPriceTarget(${i})">改</button> <button class="link danger" onclick="delPriceTarget(${i})">删</button></td>
    </tr>`).join("");

  root.innerHTML = `
    <h2>等级与定价 Grades & Pricing</h2>
    <p class="muted">同一批果成本是共享的（同树同肥），<b>等级只影响收入</b>——A 级占比越高、越接近目标价，利润越好。这是提利润最大的杠杆。</p>

    <div class="alerts ${up.belowCount || up.gradeAPct < 0.4 ? '' : 'ok'}">
      <strong>💡 升级空间 Upside</strong>
      <ul>
        ${up.belowCount ? `<li>有 <b>${up.belowCount}</b> 单卖价低于目标价，若都卖到目标价可多赚约 <b>${fmtMoney(up.pricingUpside)}</b>。</li>` : `<li>✅ 暂无低于目标价的订单。</li>`}
        <li>当前 A 级占比 <b>${fmtPct(up.gradeAPct)}</b>${up.gradeAPct < 0.4 ? "——偏低，提升采收/分选品质能把更多果做成 A 级，单价高一截。" : "——不错，继续保持。"}</li>
      </ul>
    </div>

    <div class="cards">${mixCards}</div>

    <div class="charts">
      <div class="chart-box"><h3>等级构成 Grade Mix（kg）</h3><canvas id="cGradeMix"></canvas></div>
      <div class="chart-box"><h3>各等级 成交均价 vs 目标价</h3><canvas id="cGradePrice"></canvas></div>
    </div>

    <h3 style="margin-top:20px">各等级销售 Sales by Grade</h3>
    <table class="tbl">
      <thead><tr><th>等级</th><th>已卖(kg)</th><th>成交均价</th><th>目标均价</th><th>与目标差额</th></tr></thead>
      <tbody>${gradeRows}</tbody>
    </table>

    ${below.length ? `<h3 style="margin-top:20px">⚠ 卖低了的订单 Below Target</h3>
    <table class="tbl"><thead><tr><th>订单</th><th>品种</th><th>等级</th><th>单价/目标</th><th>数量</th><th>少赚</th></tr></thead>
      <tbody>${belowRows}</tbody></table>` : ""}

    <h3 style="margin-top:20px">目标价对照表 Price Targets（品种 × 等级该卖多少）</h3>
    <button class="btn" onclick="editPriceTarget()">+ 新增目标价</button>
    <table class="tbl">
      <thead><tr><th>品种</th><th>等级</th><th>目标价</th><th></th></tr></thead>
      <tbody>${ptRows || `<tr><td colspan="4" class="muted">还没设目标价。</td></tr>`}</tbody>
    </table>
  `;
  drawGradeMix(mix); drawGradePrice(byG);
}

window.editPriceTarget = function (idx) {
  const p = (idx != null) ? DATA.priceTargets[idx] : null;
  formModal(`${p ? "编辑" : "新增"}目标价 Price Target`, `
    ${field("variety", "品种 Variety", "text", p ? p.variety : "", "如 猫山王 Musang King")}
    <label class="fld"><span>等级 Grade</span>
      <select id="fld_grade">
        <option value="A" ${p && p.grade === 'A' ? 'selected' : ''}>A 级</option>
        <option value="B" ${p && p.grade === 'B' ? 'selected' : ''}>B 级</option>
        <option value="C" ${p && p.grade === 'C' ? 'selected' : ''}>C 级</option>
      </select></label>
    ${field("targetPrice", "目标价/kg Target Price", "number", p ? p.targetPrice : 0)}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    if (!DATA.priceTargets) DATA.priceTargets = [];
    const rec = { variety: g("variety"), grade: g("grade"), targetPrice: Number(g("targetPrice")) || 0 };
    if (p) Object.assign(p, rec); else DATA.priceTargets.push(rec);
    saveData(); closeModal(); renderAll();
  });
};
window.delPriceTarget = function (idx) {
  if (!confirm("确定删除？")) return;
  DATA.priceTargets.splice(idx, 1); saveData(); renderAll();
};

/* ---------- 4.5 应收/客户 AR & Merchants ---------- */
function renderMerchants(root) {
  const stats = calc.byMerchant(DATA);
  const rows = DATA.merchants.map(m => {
    const st = stats.find(s => s.name === m.name) || { weightKg: 0, received: 0, ar: 0 };
    return `<tr>
      <td>${esc(m.name)}</td><td>${esc(m.contact)}</td><td>${esc(m.terms)}</td>
      <td>${fmtKg(st.weightKg)}</td><td>${fmtMoney(st.received)}</td>
      <td class="${st.ar > 0 ? 'neg' : ''}">${fmtMoney(st.ar)}</td>
      <td>${esc(m.note)}</td>
      <td><button class="link" onclick="editMerchant('${m.id}')">改</button> <button class="link danger" onclick="delItem('merchants','${m.id}')">删</button></td>
    </tr>`;
  }).join("");
  root.innerHTML = `
    <h2>应收/客户 AR & Merchants</h2>
    <button class="btn" onclick="editMerchant()">+ 新增商家 New Merchant</button>
    <table class="tbl">
      <thead><tr><th>商家</th><th>联系</th><th>账期</th><th>累计批发量</th><th>已回款</th><th>未回款 AR</th><th>备注</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted">还没有商家。</td></tr>`}</tbody>
    </table>
  `;
}

window.editMerchant = function (id) {
  const m = id ? DATA.merchants.find(x => x.id === id) : null;
  const f = (k) => m ? (m[k] || "") : "";
  formModal(`${m ? "编辑" : "新增"}商家 Merchant`, `
    ${field("name", "名称 Name", "text", f("name"))}
    ${field("contact", "联系方式 Contact", "text", f("contact"), "电话/微信")}
    ${field("terms", "账期 Terms", "text", f("terms"), "如 月结30天 / 货到付款")}
    ${field("note", "备注 Note", "text", f("note"), "如 常压价、退货多")}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    const rec = { id: m ? m.id : uid("M"), name: g("name"), contact: g("contact"), terms: g("terms"), note: g("note") };
    if (m) Object.assign(m, rec); else DATA.merchants.push(rec);
    saveData(); closeModal(); renderAll();
  });
};

/* ===================================================================
   5. 通用：删除 / 表单弹窗 / 字段
   =================================================================== */
window.delItem = function (coll, id) {
  if (!confirm("确定删除？")) return;
  DATA[coll] = DATA[coll].filter(x => x.id !== id);
  saveData(); renderAll();
};

function field(name, label, type, value, placeholder = "") {
  return `<label class="fld"><span>${label}</span>
    <input id="fld_${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === 'number' ? 'step="any"' : ''} /></label>`;
}

function formModal(title, bodyHtml, onSave) {
  const m = $("#modal");
  m.innerHTML = `<div class="modal-card">
    <h3>${esc(title)}</h3>
    <div class="form">${bodyHtml}</div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="closeModal()">取消 Cancel</button>
      <button class="btn" id="modalSave">保存 Save</button>
    </div></div>`;
  m.classList.add("show");
  $("#modalSave").onclick = onSave;
}
window.closeModal = function () { $("#modal").classList.remove("show"); $("#modal").innerHTML = ""; };

/* ===================================================================
   6. 图表（Chart.js）
   =================================================================== */
function drawMonthly() {
  const s = calc.monthlySeries(DATA);
  if (!window.Chart || !$("#cMonthly")) return;
  charts.monthly = new Chart($("#cMonthly"), {
    type: "line",
    data: {
      labels: s.map(x => x.ym),
      datasets: [
        { label: "收入 Revenue", data: s.map(x => Math.round(x.revenue)), borderColor: "#2e7d32", tension: .3 },
        { label: "成本 Cost", data: s.map(x => Math.round(x.cost)), borderColor: "#c62828", tension: .3 },
        { label: "利润 Profit", data: s.map(x => Math.round(x.profit)), borderColor: "#1565c0", tension: .3 }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}
function drawLoss(loss) {
  if (!window.Chart || !$("#cLoss")) return;
  charts.loss = new Chart($("#cLoss"), {
    type: "doughnut",
    data: {
      labels: ["园区坏果 Farm", "运输坏果 Transit", "商家拒收 Rejected"],
      datasets: [{ data: [loss.farmAmt, loss.transitAmt, loss.rejectAmt].map(x => Math.round(x)), backgroundColor: ["#8d6e63", "#ef6c00", "#ad1457"] }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}
function drawVariety() {
  const d = calc.profitByVariety(DATA);
  if (!window.Chart || !$("#cVariety")) return;
  charts.variety = new Chart($("#cVariety"), {
    type: "bar",
    data: { labels: d.map(x => x.variety), datasets: [{ label: "利润 Profit", data: d.map(x => Math.round(x.profit)), backgroundColor: d.map(x => x.profit >= 0 ? "#2e7d32" : "#c62828") }] },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}
function drawGradeMix(mix) {
  if (!window.Chart || !$("#cGradeMix")) return;
  charts.gradeMix = new Chart($("#cGradeMix"), {
    type: "doughnut",
    data: { labels: ["A 级", "B 级", "C 级"], datasets: [{ data: [mix.kg.A, mix.kg.B, mix.kg.C].map(x => Math.round(x)), backgroundColor: ["#2e7d32", "#f9a825", "#8d6e63"] }] },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}
function drawGradePrice(byG) {
  if (!window.Chart || !$("#cGradePrice")) return;
  charts.gradePrice = new Chart($("#cGradePrice"), {
    type: "bar",
    data: {
      labels: byG.map(g => g.grade + " 级"),
      datasets: [
        { label: "成交均价 Sold", data: byG.map(g => Math.round(g.avgPrice * 10) / 10), backgroundColor: "#2e7d32" },
        { label: "目标价 Target", data: byG.map(g => Math.round(g.targetAvg * 10) / 10), backgroundColor: "#c8e6c9" }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } }, scales: { y: { title: { display: true, text: "/kg" } } } }
  });
}

/* ===================================================================
   7. 导出 Excel(CSV) / 导入导出 JSON
   =================================================================== */
function download(filename, text, mime = "text/plain") {
  const blob = new Blob(["﻿" + text], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

window.exportExcel = function () {
  const lines = [];
  const row = (arr) => lines.push(arr.map(v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","));
  row(["==== 采收批次 Batches ===="]);
  row(["批次", "日期", "品种", "地块", "树龄", "采收方式", "出肉率%", "采收kg", "园区坏果kg", "A级kg", "B级kg", "C级kg", "真实可售kg", "真实成本", "单位成本/kg", "批次盈亏"]);
  DATA.batches.forEach(b => { const gd = calc.batchGradeKg(b); row([b.id, b.date, b.variety, b.plot, TREE_AGE_LABELS[b.treeAge || ""], HARVEST_LABELS[b.harvestMethod || ""], b.pulpYieldPct || 0, b.harvestWeightKg, b.farmSpoilageKg,
    gd.A.toFixed(1), gd.B.toFixed(1), gd.C.toFixed(1), calc.sellableKg(DATA, b).toFixed(1), calc.realTotalCost(DATA, b).toFixed(2), calc.realUnitCost(DATA, b).toFixed(2), calc.batchPnL(DATA, b).toFixed(2)]); });
  row([]);
  row(["==== 批发订单 Orders ===="]);
  row(["日期", "商家", "等级", "批次", "数量kg", "单价", "目标价", "运输坏果kg", "拒收kg", "开票", "实收", "回款状态"]);
  DATA.orders.forEach(o => { const m = DATA.merchants.find(x => x.id === o.merchant); const tgt = o.grade ? calc.targetPrice(DATA, calc.orderVariety(DATA, o), o.grade) : 0; row([o.date, m ? m.name : o.merchant, o.grade || "", (o.batchIds || []).join("/"), o.weightKg, o.unitPrice, tgt || "", o.transitSpoilageKg, o.rejectedKg, o.amountBilled, o.amountReceived, o.paymentStatus]); });
  row([]);
  const loss = calc.lossBreakdown(DATA), s = calc.summary(DATA, "all"), mix = calc.gradeMix(DATA), byG = calc.byGrade(DATA);
  row(["==== 等级汇总 Grades ===="]);
  row(["等级", "库存kg", "库存占比", "已卖kg", "成交均价", "目标均价", "与目标差额"]);
  byG.forEach(g => row([g.grade, mix.kg[g.grade].toFixed(1), (mix.pct[g.grade] * 100).toFixed(1) + "%", g.weightKg.toFixed(1), g.avgPrice.toFixed(2), g.targetAvg.toFixed(2), g.gapAmt.toFixed(2)]));
  row([]);
  row(["==== 汇总 Summary ===="]);
  row(["总收入", s.revenue.toFixed(2)]); row(["真实成本", s.cost.toFixed(2)]); row(["净利", s.netProfit.toFixed(2)]); row(["净利率", (s.netMargin * 100).toFixed(1) + "%"]);
  row(["总损耗kg", loss.totalLossKg.toFixed(1)]); row(["总损耗金额", loss.totalLossAmt.toFixed(2)]); row(["应收账款", s.accountsReceivable.toFixed(2)]);
  download("durian-farm-" + new Date().toISOString().slice(0, 10) + ".csv", lines.join("\n"), "text/csv");
};

window.exportJSON = function () { download("farm-data-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(DATA, null, 2), "application/json"); };
window.importJSON = function () {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
  inp.onchange = async () => { const file = inp.files[0]; if (!file) return; try { DATA = JSON.parse(await file.text()); saveData(); renderAll(); alert("导入成功 ✓"); } catch (e) { alert("导入失败：" + e.message); } };
  inp.click();
};

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker 注册失败", e));
}

/* ===================================================================
   8. 启动
   =================================================================== */
function init() {
  DATA = loadData();
  $("#farmName").textContent = (DATA.meta && DATA.meta.farmName) || "我的榴莲庄";
  window.addEventListener("hashchange", renderAll);
  $("#btnConnect").onclick = connectFile;
  $("#btnExcel").onclick = exportExcel;
  $("#btnExportJSON").onclick = exportJSON;
  $("#btnImportJSON").onclick = importJSON;
  if (!window.showOpenFilePicker) setFileStatus("提示：用 Chrome 打开可一键连接数据文件给 AI 团队读；当前浏览器请用导入/导出 JSON。");
  registerServiceWorker();
  renderAll();
}
document.addEventListener("DOMContentLoaded", init);
