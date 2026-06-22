#!/usr/bin/env node
// Minimal Playwright driver for the durian dashboard (static vanilla-JS app).
// Usage:
//   node driver.mjs serve            # start http server in background, print PID
//   node driver.mjs shot <out.png> [#view]   # launch chromium, goto view, screenshot
//   node driver.mjs click <selector> <out.png>  # click a selector then screenshot
//   node driver.mjs eval <jsExpr>     # run JS in page context, print JSON result
//
// Env:
//   DURIAN_PORT   (default 8743) - port the static server listens on / is expected on

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..'); // duriansystem/
const port = process.env.DURIAN_PORT || '8743';
const baseUrl = `http://127.0.0.1:${port}/dashboard/index.html`;

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

const [, , cmd, ...args] = process.argv;

if (cmd === 'serve') {
  const child = spawn(process.platform === 'win32' ? 'python' : 'python3',
    ['-m', 'http.server', port, '--directory', projectRoot],
    { stdio: 'ignore', detached: true });
  child.unref();
  console.log(`server pid=${child.pid} url=${baseUrl}`);
} else if (cmd === 'shot') {
  const [out, hash] = args;
  await withPage(async (page) => {
    await page.goto(baseUrl + (hash || ''));
    await page.waitForTimeout(300); // let renderAll() run
    await page.screenshot({ path: out, fullPage: true });
    console.log(`saved ${out}`);
  });
} else if (cmd === 'click') {
  const [selector, out] = args;
  await withPage(async (page) => {
    await page.goto(baseUrl);
    await page.waitForTimeout(300);
    await page.click(selector);
    await page.waitForTimeout(300);
    if (out) await page.screenshot({ path: out, fullPage: true });
    console.log(out ? `clicked ${selector}, saved ${out}` : `clicked ${selector}`);
  });
} else if (cmd === 'eval') {
  const [expr] = args;
  await withPage(async (page) => {
    await page.goto(baseUrl);
    await page.waitForTimeout(300);
    const result = await page.evaluate(expr);
    console.log(JSON.stringify(result, null, 2));
  });
} else {
  console.error('usage: node driver.mjs <serve|shot|click|eval> [...args]');
  process.exit(1);
}
