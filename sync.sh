#!/usr/bin/env bash
# 把本机正在用的皮肤与脚本收进仓库，然后推 GitHub。
# 只保留最新完整结果：直接覆盖同名文件，不生成任何版本目录或备份。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEME_DIR="${WB_THEME_DIR:-$HOME/.workbuddy/appearance-resources/theme-tkbera-1789703092000}"
SKILL_SCRIPTS="${WB_SKILL_SCRIPTS:-$HOME/.workbuddy/skills/workbuddy-custom-skin/scripts}"

[ -f "$THEME_DIR/skin.v2.css" ] || { echo "[sync] 找不到皮肤: $THEME_DIR/skin.v2.css"; exit 1; }

cp -f "$THEME_DIR/skin.v2.css" "$REPO/skin.v2.css"
for f in set_video_skin.js dump_ls.js; do
  [ -f "$SKILL_SCRIPTS/$f" ] && cp -f "$SKILL_SCRIPTS/$f" "$REPO/scripts/$f"
done
echo "[sync] 已收集皮肤与脚本"

cd "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "[sync] 没有变化，跳过提交"
  exit 0
fi
git commit -q -m "sync: $(date '+%Y-%m-%d %H:%M') 最新完整版"
echo "[sync] 已提交 $(git rev-parse --short HEAD)"

# 本机 gitconfig 把 github.com 全量重写到只读镜像 gh-proxy，直接 push 必失败。
# 用一份临时全局配置绕开重写规则，同时保留 credential.helper 以便弹授权窗。
if git config --global --get-regexp '^url\..*\.insteadof$' >/dev/null 2>&1; then
  NP="$HOME/git-noproxy.gitconfig"
  printf '[credential]\n\thelper = manager\n' > "$NP"
  GIT_CONFIG_GLOBAL="$NP" git push origin HEAD
else
  git push origin HEAD
fi
echo "[sync] 推送完成"
