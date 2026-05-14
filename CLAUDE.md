# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**typora-next**: A high-quality markdown previewer with light editing capabilities.

**定位**: 重预览、轻编辑
- 默认显示渲染结果，快捷键切换源码编辑
- 特色：极致数学渲染 + 丰富图表支持 + 代码块美化 + Obsidian 语法兼容

**Tech Stack**: Rust + Tauri 2.x (WebView 渲染)，前端 Vanilla JS（无框架）

## Architecture

```
src-tauri/
├── src/
│   ├── lib.rs       # Markdown rendering + Tauri commands
│   └── main.rs      # App entry point
└── tauri.conf.json  # Tauri configuration

dist/                 # WebView frontend (Tauri loads this)
├── index.html        # Main preview container
├── styles/           # CSS themes (light/dark via CSS variables)
├── scripts/          # Vanilla JS: tab management, rendering pipeline, UI
└── vendor/           # Third-party libraries (KaTeX, Mermaid, Prism, Reveal.js)
```

**前端无框架**：所有交互逻辑在 `dist/scripts/main.js` 中用原生 JS 实现，不依赖 React/Vue 等框架。DOM 操作直接通过 `document.createElement` / `addEventListener` 完成。

## Rendering Pipeline

```
.md file → pulldown-cmark → HTML fragments
         ↓
    Math/Diagram extraction → %%MATH_BLOCK_N%% / %%MERMAID_BLOCK_N%% placeholders
         ↓
    Combined HTML → WebView render → KaTeX/Mermaid/Prism post-processing
```

**关键细节**：
- Markdown 解析前，数学公式和 Mermaid 代码块被提取并用 `%%MATH_BLOCK_N%%` / `%%MERMAID_BLOCK_N%%` 占位符替换，避免被 pulldown-cmark 转义
- 禁止使用 `\x00` 等控制字符作为占位符（会导致 DOM 解析异常）

## Key Dependencies

### Rust
- `pulldown-cmark` - CommonMark + GFM parsing
- `tauri` 2.x - Cross-platform WebView window
- `notify` - File watching for external modifications
- `ureq` - HTTP client for AI API calls

### Web Rendering
- **KaTeX** - 数学渲染
- **Mermaid.js** - 图表渲染
- **Prism.js** - 代码高亮（Tomorrow 暗色主题）
- **Reveal.js** - 幻灯片放映（iframe overlay 方案）

## Development Commands

### 路径空格问题

项目原始路径 `C:\CODE\open Typora` 有空格，GNU toolchain 的 `dlltool.exe` 无法处理。

**解决方案**：使用 junction 路径编译
```powershell
# 从 junction 路径编译
cd C:\CODE\typora-next\src-tauri

# 或 Bash
cd /c/CODE/typora-next/src-tauri
```

### 编译

```bash
# 必须将 MinGW 加入 PATH（编译和打包都需要）
export PATH="/c/Users/17625/scoop/apps/mingw/15.2.0-rt_v13-rev0/bin:$PATH"

# 快速检查（不生成二进制）
cargo check

# Debug 编译
cargo build

# Release 编译
cargo build --release

# 打包安装包（MSI + NSIS）
cargo tauri build
```

### 运行

```bash
# 从 release 目录启动（需要 DLL 在同目录）
cd /c/CODE/typora-next/src-tauri/target/release
./app.exe
```

## Important Notes

### Release 模式前端嵌入

Tauri release 模式下，前端资源（dist/）在编译时嵌入 exe。修改 dist/ 后必须重新完整编译才能生效，增量编译不会重新嵌入资源。

**验证发布版本的三步**：
1. `ls -lh target/release/app.exe` 确认文件存在
2. `stat target/release/app.exe` 确认时间戳是刚才
3. 手动启动应用确认变更生效

### 安全注意事项

`tauri.conf.json` 中 `assetProtocol.scope` 当前为 `"**"`（允许访问任意路径），生产环境应限定到打开文件目录。

### 编辑定位

**Claude 不得自行执行 `git commit` 或 `git push`**。所有提交操作必须由用户明确授权。

- 代码修改完成后，应告知用户改动内容并询问是否提交
- 用户说"提交"、"commit"或明确授权后，方可执行提交
- 用户说"不要提交"或类似拒绝时，必须尊重用户决定

### Code Style

- Rust: `cargo fmt` + `cargo clippy`
- 前端：匹配现有原生 JS 风格，不引入框架
- 最小代码解决问题，不做过度抽象

## 上下文管理

本项目使用 **daily-reflection** skill 进行跨会话状态同步，数据存放在 `.daily_reflection/`：

- `context-sync.json` — 核心状态（进度、待办、活跃陷阱、最近文件）
- `decisions.md` — 决策记录（活跃区 + 归档区）
- `archive/` — 归档历史

**不再使用 project harness**（已移除 `.project/` 目录）。
