# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**typora-next**: A high-quality markdown previewer with light editing capabilities.

**定位**: 重预览、轻编辑
- 默认显示渲染结果，快捷键切换源码编辑
- 特色：极致数学渲染 + 丰富图表支持 + 代码块美化

**Tech Stack**: Rust + Tauri (WebView 渲染)

## Architecture

```
src/
├── core/           # Rust markdown processing
│   ├── parser/     # pulldown-cmark + extensions
│   ├── renderer/   # HTML generation with embedded scripts
│   └── syntax/     # Math/diagram/code block handlers
├── web/            # WebView frontend (Tauri loads this)
│   ├── index.html  # Main preview container
│   ├── css/        # Premium styling and themes
│   └── js/         # KaTeX/Mermaid/Prism integration
└── ui/             # Tauri window management
    ├── window.rs   # Window state, shortcuts, file handling
    └── commands.rs # IPC between Rust and WebView
```

## Key Dependencies

### Rust
- `pulldown-cmark` - CommonMark + GFM parsing
- `tauri` - Cross-platform WebView window
- `serde` - Config serialization

### Web Rendering (超越 Typora 的关键)
- **KaTeX** - 数学渲染（比 MathJax 快 10x）
- **Mermaid** - 流程图、时序图、甘特图
- **Prism.js** - 代码高亮（自定义精美样式）
- **Markmap** - Mind map from markdown lists

## Development Commands

### 重要：路径空格问题

项目路径 `C:\CODE\open Typora` 有空格，GNU toolchain 的 `dlltool.exe` 无法处理。

**解决方案**：创建 junction point
```powershell
New-Item -ItemType Junction -Path 'C:\CODE\typora-next' -Target 'C:\CODE\open Typora'
```

### 编译命令

```powershell
# 设置 PATH 包含 MinGW 的 dlltool
$env:PATH = 'C:\Users\17625\scoop\apps\mingw\15.2.0-rt_v13-rev0\bin;' + $env:PATH

# 从 junction 路径编译
cd C:\CODE\typora-next\src-tauri
cargo build --release
```

编译输出位置：
- `src-tauri/target/release/app.exe` - 桌面应用
- `src-tauri/target/release/WebView2Loader.dll` - WebView 运行时

### 运行应用

```powershell
# 从 release 目录启动（需要 DLL 在同目录）
cd C:\CODE\open Typora\src-tauri\target\release
.\app.exe
```

### 其他命令

```bash
# Development (hot reload) - 需要 npm
cargo tauri dev

# Build installer (MSI/NSIS)
cargo tauri build

# CLI only (无 GUI)
cargo run -- render input.md output.html
```

## MVP Features

| 功能 | 优先级 | 实现方式 |
|------|--------|----------|
| 打开 .md 文件渲染 | P0 | pulldown-cmark → HTML |
| 数学公式渲染 | P0 | KaTeX (inline + block) |
| 代码块高亮 | P0 | Prism.js + 自定义主题 |
| 图表渲染 | P1 | Mermaid (flowchart, sequence) |
| 切换源码模式 | P1 | 快捷键 Ctrl+E |
| 主题系统 | P2 | CSS 变量 + 主题文件 |

## Rendering Pipeline

```
.md file → pulldown-cmark → HTML fragments
         ↓
    Math/Diagram extraction → KaTeX/Mermaid placeholders
         ↓
    Combined HTML → WebView render
```

**Key insight**: 预览器不需要 WYSIWYG 的复杂交互，专注渲染质量即可。

## ⚠️ 铁律

### 禁止主动提交代码

**Claude 不得自行执行 `git commit` 或 `git push`**。所有提交操作必须由用户明确授权后才能执行。

- 代码修改完成后，应告知用户改动内容并询问是否提交
- 用户说"提交"、"commit"或明确授权后，方可执行提交
- 用户说"不要提交"或类似拒绝时，必须尊重用户决定

## Code Style

- Rust: `cargo fmt` + `cargo clippy`
- 最小代码解决问题，不做过度抽象