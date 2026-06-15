#!/bin/bash
# 双击运行：把这台电脑上的改动（数据、记录等）备份上传到 GitHub
# 用法：在这台电脑改完数据后，双击我即可。

cd "$(dirname "$0")" || exit 1

echo "🌰 榴莲庄 · 备份上传到 GitHub"
echo "================================"

# 先拉一次，避免和另一台电脑的改动冲突
echo "→ 先检查云端有没有新改动..."
git pull --no-edit origin main 2>&1

if [ -z "$(git status --porcelain)" ]; then
  echo ""
  echo "✅ 没有新改动，云端已是最新。不用上传。"
else
  echo "→ 发现改动，正在打包上传..."
  git add -A
  git commit -m "数据备份 $(date '+%Y-%m-%d %H:%M')"
  if git push origin main 2>&1; then
    echo ""
    echo "✅ 备份完成！数据已安全上传到 GitHub。"
  else
    echo ""
    echo "⚠️ 上传失败。可能是网络问题或需要重新登录 GitHub。"
    echo "   把上面的红色文字截图发给 Claude 看看。"
  fi
fi

echo ""
echo "（可以关掉这个窗口了）"
echo ""
read -n 1 -s -r -p "按任意键关闭..."
