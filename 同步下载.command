#!/bin/bash
# 双击运行：从 GitHub 把最新数据下载到这台电脑
# 用法：换电脑、或开工前，先双击我拿到最新数据。

cd "$(dirname "$0")" || exit 1

echo "🌰 榴莲庄 · 从 GitHub 同步最新数据"
echo "================================"

# 如果本地有还没上传的改动，先提醒，避免被覆盖
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️ 注意：这台电脑有还没上传的改动。"
  echo "   建议先双击「备份上传」再来同步，否则改动可能丢失。"
  echo ""
  read -p "仍要继续下载吗？(y/n) " ans
  if [ "$ans" != "y" ]; then
    echo "已取消。请先运行「备份上传」。"
    read -n 1 -s -r -p "按任意键关闭..."
    exit 0
  fi
fi

echo "→ 正在下载最新数据..."
if git pull --no-edit origin main 2>&1; then
  echo ""
  echo "✅ 已是最新！现在打开仪表盘就是最新数据。"
  echo "   （仪表盘记得再点一次「连接数据文件」）"
else
  echo ""
  echo "⚠️ 下载失败。把上面的红色文字截图发给 Claude 看看。"
fi

echo ""
read -n 1 -s -r -p "按任意键关闭..."
