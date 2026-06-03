#!/bin/bash
# =============================================================================
# Typora Next - macOS 自动化构建脚本
# 用途：从远端同步最新代码，应用 macOS 适配，打包 DMG，推送到 fork 并生成 PR 链接
# 用法：./build-macos.sh
# =============================================================================

set -euo pipefail

# 配置
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH_NAME="lulu"
UPSTREAM_REMOTE="origin"
UPSTREAM_OWNER="konghaojie-k2"
UPSTREAM_REPO="typora-next"
MAIN_BRANCH="master"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
pr()    { echo -e "${CYAN}[PR]${NC}    $*"; }

# =============================================================================
# macOS 适配 Patch（内联，不依赖外部文件）
# =============================================================================
apply_macos_patch() {
    local patch_file
    patch_file="$(mktemp)"
    cat > "$patch_file" << 'PATCH_EOF'
diff --git a/src-tauri/src/lib.rs b/src-tauri/src/lib.rs
index 1e76f3f..e35fc95 100644
--- a/src-tauri/src/lib.rs
+++ b/src-tauri/src/lib.rs
@@ -825,36 +825,47 @@ fn show_in_folder(path: String) -> Result<(), String> {
     result.map(|_| ()).map_err(|e| format!("无法打开文件夹: {}", e))
 }

-/// Export markdown to Word document via md2docx_service
+/// Export markdown to Word document via md2docx_service (Windows only)
 #[tauri::command]
 async fn export_word(markdown: String, file_name: String, app: tauri::AppHandle) -> Result<String, String> {
-    let resp = ureq::post("http://127.0.0.1:6007/convert")
-        .set("Content-Type", "text/plain; charset=utf-8")
-        .send_string(&markdown)
-        .map_err(|e| format!("md2docx_service 请求失败: {}", e))?;
-
-    let mut bytes = Vec::new();
-    resp.into_reader()
-        .read_to_end(&mut bytes)
-        .map_err(|e| format!("读取响应失败: {}", e))?;
-
-    let default_name = file_name.replace(".md", ".docx").replace(".markdown", ".docx");
-
-    use tauri_plugin_dialog::DialogExt;
-    let file_path = app.dialog()
-        .file()
-        .add_filter("Word Document", &["docx"])
-        .set_file_name(&default_name)
-        .blocking_save_file();
+    #[cfg(not(windows))]
+    {
+        let _ = markdown;
+        let _ = file_name;
+        let _ = app;
+        return Err("Word 导出功能当前仅支持 Windows 平台".to_string());
+    }

-    match file_path {
-        Some(path) => {
-            let path_ref = path.as_path().unwrap_or(std::path::Path::new(""));
-            std::fs::write(path_ref, &bytes)
-                .map_err(|e| format!("写入文件失败: {}", e))?;
-            Ok(path_ref.display().to_string())
+    #[cfg(windows)]
+    {
+        let resp = ureq::post("http://127.0.0.1:6007/convert")
+            .set("Content-Type", "text/plain; charset=utf-8")
+            .send_string(&markdown)
+            .map_err(|e| format!("md2docx_service 请求失败: {}", e))?;
+
+        let mut bytes = Vec::new();
+        resp.into_reader()
+            .read_to_end(&mut bytes)
+            .map_err(|e| format!("读取响应失败: {}", e))?;
+
+        let default_name = file_name.replace(".md", ".docx").replace(".markdown", ".docx");
+
+        use tauri_plugin_dialog::DialogExt;
+        let file_path = app.dialog()
+            .file()
+            .add_filter("Word Document", &["docx"])
+            .set_file_name(&default_name)
+            .blocking_save_file();
+
+        match file_path {
+            Some(path) => {
+                let path_ref = path.as_path().unwrap_or(std::path::Path::new(""));
+                std::fs::write(path_ref, &bytes)
+                    .map_err(|e| format!("写入文件失败: {}", e))?;
+                Ok(path_ref.display().to_string())
+            }
+            None => Err("用户取消了保存".to_string()),
         }
-        None => Err("用户取消了保存".to_string()),
     }
 }

diff --git a/src-tauri/tauri.conf.json b/src-tauri/tauri.conf.json
index 73d21d6..6d209cc 100644
--- a/src-tauri/tauri.conf.json
+++ b/src-tauri/tauri.conf.json
@@ -2,7 +2,7 @@
   "$schema": "https://schema.tauri.app/config/2",
   "productName": "TyporaNext",
   "version": "0.1.2",
-  "identifier": "com.typora-next.app",
+  "identifier": "com.typora-next",
   "build": {
     "frontendDist": "../dist",
     "beforeDevCommand": "",
@@ -38,9 +38,7 @@
       "icons/icon.icns",
       "icons/icon.ico"
     ],
-    "resources": [
-      "bin/md2docx_service-x86_64-pc-windows-gnu.exe"
-    ],
+    "resources": [],
     "fileAssociations": [
       {
         "ext": ["md", "markdown"],
PATCH_EOF

    # 先重置这两个文件到上游状态，确保 patch 能干净应用
    git checkout "$UPSTREAM_REMOTE/$MAIN_BRANCH" -- src-tauri/tauri.conf.json src-tauri/src/lib.rs 2>/dev/null || true

    if git apply --check "$patch_file" 2>/dev/null; then
        git apply "$patch_file"
        ok "macOS 适配修改已应用"
    else
        warn "Patch 可能已有部分应用，尝试强制应用..."
        git apply --3way "$patch_file" || git apply "$patch_file" --reject || error "Patch 应用失败"
    fi

    rm -f "$patch_file"
}

# =============================================================================
# 步骤 0：环境检查
# =============================================================================
info "检查必要工具..."

command -v git &>/dev/null || error "git 未安装"
command -v cargo &>/dev/null || { warn "cargo 未在 PATH 中，尝试加载..."; . "$HOME/.cargo/env" 2>/dev/null || error "Rust/Cargo 未安装"; }
command -v cargo &>/dev/null || error "cargo 加载失败"

if ! cargo tauri --version &>/dev/null; then
    warn "tauri-cli 未安装，正在安装..."
    cargo install tauri-cli
fi

ok "环境检查通过"

# =============================================================================
# 步骤 1：进入项目目录，获取远端最新代码
# =============================================================================
info "进入项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

info "获取上游最新代码..."
git fetch "$UPSTREAM_REMOTE" || warn "git fetch 失败，可能网络不通，继续使用本地缓存"
ok "上游代码已获取"

# =============================================================================
# 步骤 2：创建/切换 lulu 分支，rebase 到上游 master
# =============================================================================
info "切换到 $BRANCH_NAME 分支..."
git checkout -B "$BRANCH_NAME"
ok "已切换到 $BRANCH_NAME 分支"

info "Rebase 到 $UPSTREAM_REMOTE/$MAIN_BRANCH..."
if git rebase "$UPSTREAM_REMOTE/$MAIN_BRANCH"; then
    ok "Rebase 成功"
else
    error "Rebase 失败，请手动解决冲突后重试"
fi

# =============================================================================
# 步骤 3：查看与上游的区别
# =============================================================================
info "查看当前分支与上游 $MAIN_BRANCH 的区别..."
echo ""
echo "======================================================================"
git diff "$UPSTREAM_REMOTE/$MAIN_BRANCH" --stat || true
echo "======================================================================"
echo ""

# 确认是否继续
read -rp "是否继续应用 macOS 适配并打包? [Y/n]: " confirm
if [[ "$confirm" =~ ^[Nn]$ ]]; then
    info "用户取消操作"
    exit 0
fi

# =============================================================================
# 步骤 4：应用 macOS 适配修改（内联 patch）
# =============================================================================
info "应用 macOS 适配修改..."
apply_macos_patch

info "应用后的文件变更："
git diff --stat

# =============================================================================
# 步骤 5：重新打包 DMG
# =============================================================================
info "开始构建 macOS 应用包..."

cd "$PROJECT_DIR/src-tauri"

info "执行 cargo tauri build (可能需要几分钟)..."
if cargo tauri build 2>&1; then
    ok "构建成功"
else
    error "构建失败"
fi

APP_BUNDLE="$PROJECT_DIR/src-tauri/target/release/bundle/macos/TyporaNext.app"
DMG_FILE="$PROJECT_DIR/src-tauri/target/release/bundle/dmg/TyporaNext_0.1.2_aarch64.dmg"

if [ -d "$APP_BUNDLE" ]; then
    ok "应用包已生成: $APP_BUNDLE"
fi

if [ -f "$DMG_FILE" ]; then
    ok "DMG 安装包已生成: $DMG_FILE"
    ls -lh "$DMG_FILE"
else
    DMG_FOUND=$(find "$PROJECT_DIR/src-tauri/target/release/bundle/dmg" -name "*.dmg" -type f 2>/dev/null | head -1)
    if [ -n "$DMG_FOUND" ]; then
        ok "DMG 安装包已生成: $DMG_FOUND"
        ls -lh "$DMG_FOUND"
    fi
fi

# =============================================================================
# 步骤 6：提交修改
# =============================================================================
cd "$PROJECT_DIR"

info "提交 macOS 适配修改..."

if git diff --cached --quiet && git diff --quiet; then
    info "没有新的变更需要提交"
else
    git add -A
    git commit -m "build(macos): adapt for macOS platform

- Remove Windows-only md2docx_service from bundle resources
- Fix bundle identifier to avoid .app extension conflict on macOS
- Disable Word export on non-Windows platforms with friendly error message

Co-Authored-By: Claude <noreply@anthropic.com>" || warn "提交可能已有相同变更"
    ok "修改已提交"
fi

# =============================================================================
# 步骤 7：推送到 fork
# =============================================================================
info "检查 fork remote..."

# 查找用户的 fork remote（非 origin/upstream）
MY_FORK_REMOTE=""
MY_FORK_URL=""
while read -r name url _; do
    if [[ "$name" != "$UPSTREAM_REMOTE" && "$name" != "upstream" ]]; then
        # 检查是否指向用户自己的仓库（不是原仓库）
        if [[ ! "$url" =~ "$UPSTREAM_OWNER/$UPSTREAM_REPO" ]]; then
            MY_FORK_REMOTE="$name"
            MY_FORK_URL="$url"
            break
        fi
    fi
done < <(git remote -v | grep "(push)")

# 如果没有找到 fork remote，尝试自动检测 GitHub 用户名并添加
if [ -z "$MY_FORK_REMOTE" ]; then
    info "未检测到 fork remote，尝试自动配置..."

    # 尝试从 git config 获取 GitHub 用户名
    GITHUB_USER=$(git config --global user.name 2>/dev/null | tr -d ' ' || true)

    # 或者从 origin URL 推断
    if [ -z "$GITHUB_USER" ]; then
        ORIGIN_URL=$(git remote get-url "$UPSTREAM_REMOTE" 2>/dev/null || true)
        if [[ "$ORIGIN_URL" =~ github.com[:/]([^/]+)/ ]]; then
            GITHUB_USER="${BASH_REMATCH[1]}"
        fi
    fi

    # 尝试常用用户名
    if [ -z "$GITHUB_USER" ]; then
        GITHUB_USER="luckylulu-cn"
    fi

    MY_FORK_URL="https://github.com/$GITHUB_USER/$UPSTREAM_REPO.git"
    MY_FORK_REMOTE="myfork"

    info "添加 fork remote: $MY_FORK_URL"
    git remote add "$MY_FORK_REMOTE" "$MY_FORK_URL" 2>/dev/null || {
        warn "remote '$MY_FORK_REMOTE' 已存在，更新 URL..."
        git remote set-url "$MY_FORK_REMOTE" "$MY_FORK_URL"
    }
    ok "Fork remote 已配置: $MY_FORK_REMOTE → $MY_FORK_URL"
else
    ok "检测到 fork remote: $MY_FORK_REMOTE → $MY_FORK_URL"
fi

info "推送到 fork ($MY_FORK_REMOTE/$BRANCH_NAME)..."
if git push "$MY_FORK_REMOTE" "$BRANCH_NAME" --force-with-lease; then
    ok "已成功推送到 $MY_FORK_REMOTE/$BRANCH_NAME"
else
    error "推送失败。请确保你已 Fork 仓库: https://github.com/$UPSTREAM_OWNER/$UPSTREAM_REPO/fork"
fi

# =============================================================================
# 步骤 8：生成 PR 链接
# =============================================================================
info "生成 Pull Request 链接..."

# 从 fork URL 中提取用户名
FORK_OWNER=$(echo "$MY_FORK_URL" | sed -n 's|.*github\.com/\([^/]*\)/.*|\1|p')
FORK_OWNER=$(echo "$FORK_OWNER" | sed 's/[:/].*//')

if [ -n "$FORK_OWNER" ]; then
    PR_URL="https://github.com/$UPSTREAM_OWNER/$UPSTREAM_REPO/compare/$MAIN_BRANCH...$FORK_OWNER:$UPSTREAM_REPO:$BRANCH_NAME"
    echo ""
    echo "======================================================================"
    pr "🎉 自动化构建完成！"
    echo "======================================================================"
    echo ""
    echo "  分支:    $BRANCH_NAME"
    echo "  Fork:    $MY_FORK_REMOTE ($FORK_OWNER)"
    echo "  应用包:  $APP_BUNDLE"
    [ -f "$DMG_FILE" ] && echo "  DMG:     $DMG_FILE"
    echo ""
    echo "  📋 下一步：发起 Pull Request 合并到上游仓库"
    echo ""
    echo "  👉 $PR_URL"
    echo ""
    echo "  或手动访问:"
    echo "     https://github.com/$UPSTREAM_OWNER/$UPSTREAM_REPO/compare/$MAIN_BRANCH...$FORK_OWNER:$UPSTREAM_REPO:$BRANCH_NAME"
    echo ""
    echo "======================================================================"
else
    echo ""
    echo "======================================================================"
    ok "🎉 自动化构建完成！"
    echo "======================================================================"
    echo ""
    echo "  分支:    $BRANCH_NAME"
    echo "  Fork:    $MY_FORK_REMOTE"
    echo "  应用包:  $APP_BUNDLE"
    [ -f "$DMG_FILE" ] && echo "  DMG:     $DMG_FILE"
    echo ""
    warn "无法自动生成 PR 链接，请手动在 GitHub 上创建 Pull Request"
    echo ""
    echo "======================================================================"
fi
