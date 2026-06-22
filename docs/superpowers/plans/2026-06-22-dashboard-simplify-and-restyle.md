# 仪表盘简化录入 + 暖色农场风视觉刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给榴莲庄仪表盘加一个"快速记一笔"悬浮按钮（采收/卖货各 3 个字段），并把视觉换成暖色农场风（深绿渐变 KPI 卡片、更大圆角、更突出的数字）。

**Architecture:** 这是个零构建的 vanilla JS/CSS 项目（`dashboard/app.js` + `style.css` + `index.html`），没有单元测试框架。本计划沿用项目现有的验证方式——`.claude/skills/run-durian-dashboard` 里的 Playwright driver 做截图 + `eval` 检查渲染结果，把它当作这个项目的"测试"手段。所有改动只动 `dashboard/` 下的三个文件，不碰 `calc` 对象、数据 schema、Firestore/Firebase/PWA 代码。

**Tech Stack:** Vanilla JS（无框架）、原生 CSS、Chart.js（已 vendored，不涉及本次改动）。

## Global Constraints

- 不修改 `calc` 对象（`dashboard/app.js` 里的纯函数业务逻辑层）。
- 不修改数据 schema（`meta`/`fixedCosts`/`priceTargets`/`batches`/`orders`/`merchants`）。
- 不修改 Firestore/Firebase/PWA 相关代码（`firebase-init.js`、`firebase-config.js`、`sw.js`、`manifest.json`、登录逻辑）。
- 不改变 6 个视图的数量与 hash 路由方式。
- 新建记录的 ID 规则沿用现有的 `B-YYYYMMDD-NN` / `O-YYYYMMDD-NN`（用现有的 `uid()` 辅助函数模式，参考 `dashboard/app.js:622` 和 `:759` 的写法）。
- 缺失字段按现有"未知填 0"惯例处理，复用现有 `saveData()`（`dashboard/app.js:332`）做本地+Firestore 落盘，不新写持久化逻辑。

---

### Task 1: 暖色农场风 CSS 改版

**Files:**
- Modify: `dashboard/style.css:60-68`（`.cards`/`.card` 及其变体）
- Modify: `dashboard/style.css:91-96`（`.btn`）
- Modify: `dashboard/style.css:103`（`.modal-card`）

**Interfaces:**
- 不引入新 CSS 类名给其他文件消费；本任务只改既有选择器的声明值，`.card`/`.card.good`/`.card.bad`/`.card.warn`/`.btn`/`.modal-card` 这些类名继续被 `dashboard/app.js` 原样引用（见 `renderOverview`/`renderWholesale`/`renderGrades` 里 `class="card ${cls}"` 的用法），不改类名、不改 DOM 结构。

- [ ] **Step 1: 备份当前渲染截图，作为改前基准**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
nohup python3 -m http.server 8743 --directory . > /tmp/durian-server.log 2>&1 &
sleep 2
node .claude/skills/run-durian-dashboard/driver.mjs shot /tmp/before-overview.png "#overview"
node .claude/skills/run-durian-dashboard/driver.mjs shot /tmp/before-wholesale.png "#wholesale"
```
Expected: 两个 png 文件生成，无报错。

- [ ] **Step 2: 修改 `.card` 系列为深绿渐变 KPI 卡片**

把 `dashboard/style.css` 第 60–68 行：

```css
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin: 16px 0; }
.card { background: var(--card); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); border-left: 4px solid var(--green); }
.card.good { border-left-color: var(--green); }
.card.bad { border-left-color: var(--red); }
.card.warn { border-left-color: var(--amber); }
.card-label { font-size: 12.5px; color: var(--muted); }
.card-val { font-size: 24px; font-weight: 800; margin: 4px 0; }
.card-sub { font-size: 12px; color: var(--muted); }
```

替换为：

```css
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin: 16px 0; }
.card {
  background: linear-gradient(135deg, var(--green-dark), var(--green) 60%, #43a047);
  color: #fff; border-radius: 18px; padding: 16px;
  box-shadow: 0 10px 24px rgba(27, 94, 32, .25);
}
.card.good { background: linear-gradient(135deg, var(--green-dark), var(--green) 60%, #66bb6a); }
.card.bad { background: linear-gradient(135deg, #8e0000, var(--red) 60%, #e53935); }
.card.warn { background: linear-gradient(135deg, #8a4b00, var(--amber) 60%, #ffa726); }
.card-label { font-size: 12.5px; color: rgba(255, 255, 255, .85); }
.card-val { font-size: 26px; font-weight: 800; margin: 4px 0; color: #fff; }
.card-sub { font-size: 12px; color: rgba(255, 255, 255, .75); }
```

- [ ] **Step 3: 加大按钮和弹窗圆角，加按钮阴影**

把 `dashboard/style.css` 第 91–96 行：

```css
.btn { background: var(--green); color: #fff; border: none; padding: 9px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 13px; }
.btn:hover { background: var(--green-dark); }
.btn.small { padding: 7px 11px; font-size: 12px; }
.btn.ghost { background: rgba(255, 255, 255, .18); }
.toolbar .btn.ghost { color: #fff; }
.btn.ghost:not(.small) { background: #eef3ef; color: var(--ink); }
```

替换为：

```css
.btn { background: var(--green); color: #fff; border: none; padding: 9px 16px; border-radius: 12px; font-weight: 700; cursor: pointer; font-size: 13px; box-shadow: 0 2px 6px rgba(27, 94, 32, .25); }
.btn:hover { background: var(--green-dark); }
.btn.small { padding: 7px 11px; font-size: 12px; }
.btn.ghost { background: rgba(255, 255, 255, .18); box-shadow: none; }
.toolbar .btn.ghost { color: #fff; }
.btn.ghost:not(.small) { background: #eef3ef; color: var(--ink); box-shadow: none; }
```

第 103 行：

```css
.modal-card { background: #fff; border-radius: 16px; padding: 22px; width: 100%; max-width: 520px; box-shadow: 0 20px 60px rgba(0, 0, 0, .25); }
```

改为：

```css
.modal-card { background: #fff; border-radius: 18px; padding: 22px; width: 100%; max-width: 520px; box-shadow: 0 20px 60px rgba(0, 0, 0, .25); }
```

- [ ] **Step 4: 截图验证改版后效果，人工确认无回归**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs shot /tmp/after-overview.png "#overview"
node .claude/skills/run-durian-dashboard/driver.mjs shot /tmp/after-wholesale.png "#wholesale"
node .claude/skills/run-durian-dashboard/driver.mjs eval "getComputedStyle(document.querySelector('.card')).borderRadius"
```
Expected: `eval` 输出 `"18px"`；两张 after 截图里 KPI 卡片显示深绿渐变背景+白色数字，文字清晰可读（白字在深绿背景上对比度足够），布局不破。和 before 截图对比，确认表格、图表区域没有被误改。

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
git add dashboard/style.css
git commit -m "暖色农场风视觉刷新：KPI 卡片改深绿渐变白字，按钮/弹窗圆角加大"
```

---

### Task 2: 悬浮按钮 + 快速记一笔类型选择弹窗

**Files:**
- Modify: `dashboard/index.html`（在 `<div id="modal">` 后加悬浮按钮和类型选择弹窗）
- Modify: `dashboard/style.css`（加 `.fab` 样式 + 移动端媒体查询里的 `.fab` 偏移）
- Modify: `dashboard/app.js`（加 `openQuickPicker`/`closeQuickPicker` 和按钮绑定）

**Interfaces:**
- 产出：`window.openQuickPicker()`、`window.closeQuickPicker()` 两个全局函数，供 Task 3、Task 4 的"采收"/"卖货"按钮 onclick 调用。
- 消费：复用 Task 1 不变的 `.modal`/`.modal-card`/`.btn` 类名和 `dashboard/app.js:465-466` 的 `$`/`$$` 选择器辅助函数。

- [ ] **Step 1: 在 `dashboard/index.html` 加悬浮按钮和选择弹窗**

在 `dashboard/index.html` 第 45 行 `<div id="modal" class="modal"></div>` 之后插入（在 `<div id="loginGate"...>` 之前）：

```html
  <button id="fabQuick" class="fab" title="快速记一笔">➕</button>
  <div id="quickPicker" class="modal">
    <div class="modal-card" style="max-width:320px;text-align:center;">
      <h3>快速记一笔 Quick Add</h3>
      <p class="muted">只填最关键的几个数字，其余以后再补。</p>
      <div style="display:grid;gap:10px;margin-top:12px;">
        <button class="btn" id="qpHarvest">🌳 采收 Harvest</button>
        <button class="btn ghost" id="qpSell" style="background:#eef3ef;color:var(--ink);">🚚 卖货 Sell</button>
      </div>
      <div class="modal-actions" style="justify-content:center;margin-top:14px;">
        <button class="btn ghost" id="qpCancel" style="background:#eef3ef;color:var(--ink);">取消 Cancel</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: 在 `dashboard/style.css` 末尾加 `.fab` 样式**

在 `dashboard/style.css` 文件末尾（第 145 行 `}` 之后，即移动端媒体查询结束之后）追加：

```css
/* ---------- 快速记一笔悬浮按钮 ---------- */
.fab {
  position: fixed; right: 20px; bottom: 28px; width: 56px; height: 56px;
  border-radius: 50%; border: none; cursor: pointer; font-size: 24px;
  background: linear-gradient(135deg, var(--green-dark), var(--green));
  color: #fff; box-shadow: 0 8px 20px rgba(27, 94, 32, .35); z-index: 45;
  display: flex; align-items: center; justify-content: center;
}
.fab:hover { background: linear-gradient(135deg, var(--green-dark), var(--green-dark)); }

@media (max-width: 720px) {
  .fab { bottom: 76px; right: 16px; }
}
```

- [ ] **Step 3: 在 `dashboard/app.js` 加弹窗开关函数和绑定**

在 `dashboard/app.js` 里找到 `window.closeModal` 的定义（第 946 行）：

```js
window.closeModal = function () { $("#modal").classList.remove("show"); $("#modal").innerHTML = ""; };
```

在它后面（第 947 行后）插入：

```js

/* ===================================================================
   5b. 快速记一笔（悬浮按钮）
   =================================================================== */
window.openQuickPicker = function () { $("#quickPicker").classList.add("show"); };
window.closeQuickPicker = function () { $("#quickPicker").classList.remove("show"); };
```

在 `dashboard/app.js` 的 `init()` 函数里（第 977 行附近，`$("#btnImportJSON").onclick = importJSON;` 之后）加上按钮绑定：

```js
  $("#fabQuick").onclick = openQuickPicker;
  $("#qpCancel").onclick = closeQuickPicker;
  $("#qpHarvest").onclick = () => { closeQuickPicker(); quickAddBatch(); };
  $("#qpSell").onclick = () => { closeQuickPicker(); quickAddOrder(); };
```

（`quickAddBatch`/`quickAddOrder` 在 Task 3、Task 4 里定义，这一步先接好按钮，函数本体下个任务再补。）

- [ ] **Step 4: 截图验证悬浮按钮和选择弹窗显示正常**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs eval "!!document.querySelector('#fabQuick')"
node .claude/skills/run-durian-dashboard/driver.mjs click "#fabQuick" /tmp/quickpicker-open.png
node .claude/skills/run-durian-dashboard/driver.mjs eval "document.querySelector('#quickPicker').classList.contains('show')"
```
Expected: 第一条输出 `true`；第二条点击后截图显示选择弹窗（采收/卖货两个按钮）；第三条输出 `true`。

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
git add dashboard/index.html dashboard/style.css dashboard/app.js
git commit -m "加快速记一笔悬浮按钮和类型选择弹窗"
```

---

### Task 3: 快速记一笔 · 采收表单

**Files:**
- Modify: `dashboard/app.js`（在 Task 2 加的 `closeQuickPicker` 定义之后，新增 `window.quickAddBatch`）

**Interfaces:**
- 消费：`field()`（`dashboard/app.js:929`）、`formModal()`（`:934`）、`closeModal()`（`:946`）、`uid()`（`:471`）、`saveData()`（`:332`，async 函数）、`renderAll()`（`:480`）、全局 `$()`（`:465`）。
- 产出：`window.quickAddBatch()` 无参数、无返回值，被 Task 2 的 `qpHarvest` 按钮调用。生成的记录结构必须和 `window.editBatch` 保存的记录（`dashboard/app.js:621-630` 的 `rec` 对象）字段完全一致，只是大部分字段填 0/空，保证 `calc` 对象不用做任何空值特判改动。

- [ ] **Step 1: 在 `dashboard/app.js` 里 `closeQuickPicker` 定义之后加 `quickAddBatch`**

```js

window.quickAddBatch = function () {
  formModal("快速记一笔 · 采收 Quick Harvest", `
    ${field("date", "采收日期 Date", "date", new Date().toISOString().slice(0, 10))}
    ${field("variety", "品种 Variety", "text", "", "如 猫山王 Musang King")}
    ${field("harvestWeightKg", "采收重量(kg) Weight", "number", 0)}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    const num = (n) => Number(g(n)) || 0;
    const rec = {
      id: "B-" + g("date").replace(/-/g, "") + "-" + uid("").slice(-3),
      date: g("date"), variety: g("variety"), plot: "",
      harvestCount: 0, harvestWeightKg: num("harvestWeightKg"), farmSpoilageKg: 0,
      grades: { A: 0, B: 0, C: 0 },
      treeAge: "", harvestMethod: "",
      pulpYieldPct: 0, avgFruitWeightKg: 0,
      variableCosts: { labor: 0, fertilizer: 0, pesticide: 0, utilities: 0, packaging: 0, transport: 0 },
      note: "快速记录，待补充明细"
    };
    DATA.batches.push(rec);
    saveData(); closeModal(); renderAll();
  });
};
```

- [ ] **Step 2: 用 Playwright driver 走一遍快速采收流程**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs eval "
(async () => {
  window.openQuickPicker();
  document.querySelector('#qpHarvest').click();
  document.querySelector('#fld_variety').value = '测试品种';
  document.querySelector('#fld_harvestWeightKg').value = '88';
  document.querySelector('#modalSave').click();
  await new Promise(r => setTimeout(r, 300));
  const last = DATA.batches[DATA.batches.length - 1];
  return { id: last.id, variety: last.variety, harvestWeightKg: last.harvestWeightKg, note: last.note };
})()
"
```
Expected: 返回对象里 `variety` 是 `"测试品种"`、`harvestWeightKg` 是 `88`、`note` 是 `"快速记录，待补充明细"`、`id` 形如 `B-20260622-xxx`。

- [ ] **Step 3: 确认完整批次列表页能看到这条快速记录**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs shot /tmp/quickbatch-in-list.png "#batches"
```
Expected: 截图里"采收批次"表格最下面（或对应位置）能看到刚才那条"测试品种"记录，等级显示"未分级"（因为 `grades` 全是 0），真实可售/单位成本列正常计算不报错（NaN 或崩溃都算失败）。

- [ ] **Step 4: 清理测试数据，避免污染本地数据文件**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs eval "
DATA.batches = DATA.batches.filter(b => b.variety !== '测试品种');
saveData();
'cleaned'
"
```
Expected: 输出 `"cleaned"`，确认是为了不把测试记录留在本地 `data/farm-data.json` / Firestore 里。

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
git add dashboard/app.js
git commit -m "加快速记一笔·采收表单（3字段，其余缺省按0处理）"
```

---

### Task 4: 快速记一笔 · 卖货表单

**Files:**
- Modify: `dashboard/app.js`（在 `quickAddBatch` 定义之后，新增 `window.quickAddOrder`）

**Interfaces:**
- 消费：同 Task 3，另加 `DATA.merchants`（数组，元素含 `id`/`name`）。
- 产出：`window.quickAddOrder()`，被 Task 2 的 `qpSell` 按钮调用。生成的记录结构对齐 `window.editOrder` 保存的 `rec`（`dashboard/app.js:758-765`），`amountBilled`/`amountReceived` 按 `weightKg*unitPrice` 自动算出（卖货默认当场两清，老板可以事后改成未回款）。

- [ ] **Step 1: 在 `dashboard/app.js` 里 `quickAddBatch` 定义之后加 `quickAddOrder`**

```js

window.quickAddOrder = function () {
  const merchOpts = DATA.merchants.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
  formModal("快速记一笔 · 卖货 Quick Sell", `
    <label class="fld"><span>商家 Merchant</span><select id="fld_merchant">${merchOpts || '<option value="">先去「客户」加商家</option>'}</select></label>
    ${field("weightKg", "卖出重量(kg) Weight", "number", 0)}
    ${field("unitPrice", "单价 Unit Price", "number", 0)}
  `, () => {
    const g = (n) => $(`#fld_${n}`).value;
    const num = (n) => Number(g(n)) || 0;
    const weightKg = num("weightKg"), unitPrice = num("unitPrice");
    const amount = Math.round(weightKg * unitPrice * 100) / 100;
    const today = new Date().toISOString().slice(0, 10);
    const rec = {
      id: "O-" + today.replace(/-/g, "") + "-" + uid("").slice(-3),
      date: today, merchant: g("merchant"), batchIds: [], grade: "B",
      weightKg, unitPrice,
      transitSpoilageKg: 0, rejectedKg: 0,
      amountBilled: amount, amountReceived: amount,
      paymentStatus: "paid", note: "快速记录，待补充明细（未关联批次）"
    };
    DATA.orders.push(rec);
    saveData(); closeModal(); renderAll();
  });
};
```

- [ ] **Step 2: 用 Playwright driver 走一遍快速卖货流程**

先确认本地测试数据里至少有一个商家（如果 `DATA.merchants` 是空数组，这一步的下拉会显示"先去「客户」加商家"，仍可保存，`merchant` 字段会是空字符串——这是预期行为，跟完整表单逻辑一致）：

```bash
node .claude/skills/run-durian-dashboard/driver.mjs eval "
(async () => {
  window.openQuickPicker();
  document.querySelector('#qpSell').click();
  document.querySelector('#fld_weightKg').value = '50';
  document.querySelector('#fld_unitPrice').value = '20';
  document.querySelector('#modalSave').click();
  await new Promise(r => setTimeout(r, 300));
  const last = DATA.orders[DATA.orders.length - 1];
  return { id: last.id, weightKg: last.weightKg, unitPrice: last.unitPrice, amountBilled: last.amountBilled, amountReceived: last.amountReceived, paymentStatus: last.paymentStatus };
})()
"
```
Expected: 返回对象 `weightKg:50`、`unitPrice:20`、`amountBilled:1000`、`amountReceived:1000`、`paymentStatus:"paid"`。

- [ ] **Step 3: 确认批发与损耗页能看到这条记录，且总览数字没崩**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs shot /tmp/quickorder-in-list.png "#wholesale"
node .claude/skills/run-durian-dashboard/driver.mjs eval "document.querySelector('#view').innerText.includes('NaN')"
```
Expected: 截图里订单表格能看到这条新订单（数量@单价显示 `50 kg @ MYR 20.00`）；第二条 eval 输出 `false`（说明没有出现 NaN，总览/损耗计算没被空 `batchIds` 搞崩）。

- [ ] **Step 4: 清理测试数据**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs eval "
DATA.orders = DATA.orders.filter(o => !(o.weightKg === 50 && o.unitPrice === 20 && o.note === '快速记录，待补充明细（未关联批次）'));
saveData();
'cleaned'
"
```
Expected: 输出 `"cleaned"`。

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
git add dashboard/app.js
git commit -m "加快速记一笔·卖货表单（3字段，自动算开票/实收金额）"
```

---

### Task 5: 全量回归验证（桌面 + 手机视口）

**Files:**
- 不创建/修改源码文件，只验证 Task 1–4 的成果。

**Interfaces:**
- 不产出新接口，是验证任务。

- [ ] **Step 1: 桌面视口截图全部 6 个视图，人工确认暖色风格统一、无破版**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
for v in overview batches costs wholesale grades merchants; do
  node .claude/skills/run-durian-dashboard/driver.mjs shot "/tmp/final-desktop-$v.png" "#$v"
done
```
Expected: 6 张截图，每张里所有 `.card` 元素都是深绿/红/橙渐变背景+白字（不是之前的白底+左侧色条），按钮和弹窗圆角变大，悬浮的 ➕ 按钮在右下角可见且不挡内容。

- [ ] **Step 2: 手机视口截图（375×667 与 390×844），确认悬浮按钮不挡底部导航**

在 `.claude/skills/run-durian-dashboard/` 目录下新建一个一次性脚本（用完即删，不提交）：

```js
// .claude/skills/run-durian-dashboard/_tmp-mobile-check.mjs
import { chromium } from 'playwright';
const sizes = [{ name: 'se', width: 375, height: 667 }, { name: 'p12', width: 390, height: 844 }];
const browser = await chromium.launch();
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  await page.goto('http://127.0.0.1:8743/dashboard/index.html#overview');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/final-mobile-${s.name}-overview.png` });
  await page.close();
}
await browser.close();
```

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem/.claude/skills/run-durian-dashboard"
node _tmp-mobile-check.mjs
rm _tmp-mobile-check.mjs
```
Expected: 两张截图里悬浮按钮位于底部导航上方（不重叠），卡片样式和桌面端一致。

- [ ] **Step 3: 确认现有功能没有回归——完整表单、登录、同步状态条都还正常**

```bash
node .claude/skills/run-durian-dashboard/driver.mjs eval "({
  hasEditBatchBtn: !!document.querySelector('button[onclick=\"editBatch()\"]'),
  hasLoginGate: !!document.querySelector('#loginGate'),
  hasSyncStatus: !!document.querySelector('#syncStatus'),
  cardRadius: getComputedStyle(document.querySelector('.card')).borderRadius
})"
```
Expected: 四项分别为 `true`、`true`、`true`、`"18px"`——证明 Task 1-4 的改动叠加在原有登录/同步/完整表单功能之上，没有破坏它们。

- [ ] **Step 4: 关掉本地测试服务器**

```bash
pkill -f "http.server 8743" 2>/dev/null || true
```
Expected: 无报错即可（找不到进程也算成功，说明已经没在跑）。

- [ ] **Step 5: 最终确认 git 状态干净，所有改动都已提交**

```bash
cd "/c/Users/ThisPc/Downloads/new durian/duriansystem"
git status --short
git log --oneline -6
```
Expected: `git status --short` 输出为空（没有未提交的改动，且没有 `_tmp-mobile-check.mjs` 残留）；`git log` 能看到 Task 1–4 的 4 条 commit。
