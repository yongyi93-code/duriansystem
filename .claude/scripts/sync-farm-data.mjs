#!/usr/bin/env node
// 让 5 个 AI 同事和云端 Firestore 数据互通。
// pull: 把云端最新数据拉到本地 data/farm-data.json（AI 读数据前先跑这个）
// push: 把本地 data/farm-data.json 推到云端（AI 改完数据后跑这个，手机才能看到）
//
// 用法（在 duriansystem/ 根目录下）：
//   node .claude/scripts/sync-farm-data.mjs pull
//   node .claude/scripts/sync-farm-data.mjs push
//
// 需要 .claude/firebase-service-account.json（服务账号密钥，不提交到 git）

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../");
const keyPath = path.join(repoRoot, ".claude/firebase-service-account.json");
const dataPath = path.join(repoRoot, "data/farm-data.json");
const FARM_UID = "RX88ZDO3UaU1RU9dQhFmPH8pixS2"; // 老板登录账号的 Firebase UID，对应 Firestore /farmData/{uid}

if (!existsSync(keyPath)) {
  console.error("找不到服务账号密钥：" + keyPath);
  console.error("去 Firebase 控制台 → 项目设置 → 服务账号 → 生成新的私钥，保存到这个路径。");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const docRef = db.collection("farmData").doc(FARM_UID);

const mode = process.argv[2];

if (mode === "pull") {
  const snap = await docRef.get();
  if (!snap.exists) {
    console.error("云端还没有数据（farmData/" + FARM_UID + " 不存在），先在网页上登录一次让它建立初始数据。");
    process.exit(1);
  }
  const cloudData = snap.data();
  writeFileSync(dataPath, JSON.stringify(cloudData, null, 2) + "\n", "utf8");
  console.log("✓ 已从云端拉取最新数据到 data/farm-data.json（更新时间：" + (cloudData.meta?.updatedAt || "未知") + "）");
} else if (mode === "push") {
  const localData = JSON.parse(readFileSync(dataPath, "utf8"));
  localData.meta = localData.meta || {};
  localData.meta.updatedAt = new Date().toISOString();
  await docRef.set(localData);
  writeFileSync(dataPath, JSON.stringify(localData, null, 2) + "\n", "utf8");
  console.log("✓ 已把 data/farm-data.json 推送到云端，手机/电脑刷新即可看到最新数据。");
} else {
  console.error("用法: node sync-farm-data.mjs pull|push");
  process.exit(1);
}
process.exit(0);
