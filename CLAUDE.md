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

```bash
# Add Tauri CLI (first time)
cargo install tauri-cli

# Development (hot reload)
cargo tauri dev

# Build release
cargo tauri build

# Run without Tauri (test renderer only)
cargo run
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

## Code Style

- Rust: `cargo fmt` + `cargo clippy`
- 最小代码解决问题，不做过度抽象