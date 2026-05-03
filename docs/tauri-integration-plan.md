# Tauri 集成方案 (T-012)

> 本文档研究 Tauri v2 集成方案，为后续桌面应用开发提供参考。
> 状态：研究阶段，暂不实际修改代码。

## 1. 项目现状分析

### 1.1 当前项目结构

```
typora-next/
├── Cargo.toml          # Rust 项目配置
├── src/
│   ├── main.rs         # CLI 入口
│   ├── core/
│   │   ├── parser/     # Markdown 解析 (pulldown-cmark)
│   │   ├── renderer/   # HTML 渲染
│   │   └── syntax/     # 扩展语法 (数学公式等)
│   ├── editor/         # 编辑器状态管理
│   ├── web/
│   │   ├── css/        # 编辑器样式
│   │   └── js/         # WYSIWYG 编辑逻辑
│   └── plugins/        # 插件扩展 API
├── output/             # HTML 输出目录
└── tests/              # 测试文件
```

### 1.2 当前依赖

```toml
[dependencies]
pulldown-cmark = "0.12"     # CommonMark 解析
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "2.0"
```

Cargo.toml 中已有 Tauri 依赖的预留注释：
```toml
# Optional: WebView (uncomment when ready for GUI)
# tauri = { version = "2.0", features = ["devtools"] }
```

### 1.3 系统环境检查

| 依赖 | 状态 | 版本 |
|------|------|------|
| Node.js | 已安装 | v22.18.0 |
| npm | 已安装 | 10.9.3 |
| Tauri CLI | 未安装 | 需安装 |
| Rust/Cargo | 已使用 | (PATH 需配置) |

---

## 2. Tauri v2 项目结构

### 2.1 集成后的目录结构

```
typora-next/
├── Cargo.toml              # 主项目配置 (保留)
├── src-tauri/              # Tauri 后端 (新增)
│   ├── Cargo.toml          # Tauri 专用依赖
│   ├── tauri.conf.json     # Tauri 配置文件
│   ├── build.rs            # 构建脚本
│   ├── icons/              # 应用图标
│   └── src/
│       ├── main.rs         # Tauri 入口
│       ├── lib.rs          # Tauri 库
│       ├── commands/       # IPC 命令模块
│       │   ├── mod.rs
│       │   ├── file.rs     # 文件操作命令
│       │   └── editor.rs   # 编辑器命令
│       └── state.rs        # 应用状态管理
├── src/                    # 原有核心代码 (保留)
│   ├── core/               # Markdown 处理核心
│   ├── editor/             # 编辑器状态
│   └── plugins/            # 插件系统
├── src-web/                # 前端代码 (新增/重构)
│   ├── index.html          # 主页面
│   ├── main.js             # 前端入口
│   ├── styles/
│   │   ├── main.css        # 主样式
│   │   ├── editor.css      # 编辑器样式 (迁移自 src/web/css)
│   │   └── toc.css         # TOC 侧边栏样式
│   ├── scripts/
│   │   ├── editor.js       # WYSIWYG 编辑逻辑
│   │   ├── toc.js          # TOC 提取与显示
│   │   ├── shortcuts.js    # 快捷键处理
│   │   └── ipc.js          # IPC 通信封装
│   └── lib/
│       ├── katex/          # 数学公式渲染
│       ├── prism/          # 代码高亮
│       └── mermaid/        # 图表渲染
├── package.json            # 前端构建配置
└── vite.config.js          # Vite 构建配置 (推荐)
```

### 2.2 Cargo.toml 变更

**根目录 Cargo.toml** (workspace 配置)：
```toml
[workspace]
members = ["src-tauri"]
resolver = "2"

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"

[workspace.dependencies]
# 共享依赖
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "2.0"
pulldown-cmark = "0.12"
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

**src-tauri/Cargo.toml**：
```toml
[package]
name = "typora-next-app"
version.workspace = true
edition.workspace = true

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri.workspace = true
tauri-plugin-shell.workspace = true
tauri-plugin-dialog.workspace = true
tauri-plugin-fs.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true

# 引用核心 markdown 处理模块
typora-next-core = { path = "../src/core" }

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## 3. Tauri v2 初始化步骤

### 3.1 安装依赖

```powershell
# 1. 安装 Tauri CLI
npm install -g @tauri-apps/cli@latest

# 2. 安装 Rust (如未安装)
# Windows: 下载 https://win.rustup.rs/
# 或使用 winget
winget install Rustlang.Rustup

# 3. 验证安装
cargo tauri --version
npm run tauri -- --version

# 4. 安装前端构建工具 (推荐 Vite)
npm install -D vite
```

### 3.2 初始化 Tauri 项目

```powershell
# 在项目根目录执行
cd "C:/CODE/open Typora"

# 方案 A: 使用 Tauri CLI 初始化 (推荐)
npm create tauri-app@latest -- --ci

# 方案 B: 手动创建目录结构
# 创建 src-tauri 目录
mkdir src-tauri
mkdir src-tauri/src
mkdir src-tauri/icons

# 创建 src-web 目录 (或使用现有 src/web)
mkdir src-web
```

### 3.3 配置 tauri.conf.json

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Typora Next",
  "version": "0.1.0",
  "identifier": "com.typora-next.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../src-web/dist"
  },
  "app": {
    "windows": [
      {
        "title": "Typora Next",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "center": true,
        "resizable": true,
        "fullscreen": false,
        "decorations": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "plugins": {
    "shell": {
      "open": true
    },
    "dialog": {
      "all": true,
      "open": true,
      "save": true
    },
    "fs": {
      "all": true,
      "scope": ["$HOME/**", "$DOCUMENT/**", "$DOWNLOAD/**"]
    }
  }
}
```

---

## 4. IPC 通信设计

### 4.1 Rust 端命令定义

**src-tauri/src/commands/mod.rs**：
```rust
pub mod file;
pub mod editor;
pub mod render;

use serde::{Deserialize, Serialize};

/// 文件操作结果
#[derive(Debug, Serialize, Deserialize)]
pub struct FileResult {
    pub path: String,
    pub content: String,
    pub success: bool,
    pub error: Option<String>,
}

/// TOC 目录项
#[derive(Debug, Serialize, Deserialize)]
pub struct TocItem {
    pub level: u8,
    pub text: String,
    pub slug: String,
    pub line: usize,
}
```

**src-tauri/src/commands/file.rs**：
```rust
use std::fs;
use std::path::Path;
use tauri::command;
use super::FileResult;

/// 打开 Markdown 文件
#[command]
pub async fn open_file(path: String) -> FileResult {
    match fs::read_to_string(&path) {
        Ok(content) => FileResult {
            path,
            content,
            success: true,
            error: None,
        },
        Err(e) => FileResult {
            path,
            content: String::new(),
            success: false,
            error: Some(e.to_string()),
        },
    }
}

/// 保存文件
#[command]
pub async fn save_file(path: String, content: String) -> FileResult {
    match fs::write(&path, &content) {
        Ok(_) => FileResult {
            path,
            content,
            success: true,
            error: None,
        },
        Err(e) => FileResult {
            path,
            content: String::new(),
            success: false,
            error: Some(e.to_string()),
        },
    }
}

/// 使用文件对话框选择文件
#[command]
pub async fn select_file(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_file();

    file_path.map(|p| p.to_string())
}

/// 使用文件对话框保存文件
#[command]
pub async fn select_save_path(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .blocking_save_file();

    file_path.map(|p| p.to_string())
}
```

**src-tauri/src/commands/render.rs**：
```rust
use tauri::command;
use typora_next_core::parser::parse_markdown;
use typora_next_core::renderer::render_html_document;
use typora_next_core::renderer::render_markdown_with_math;

/// 渲染 Markdown 到 HTML
#[command]
pub fn render_markdown(content: String) -> String {
    let events = parse_markdown(&content);
    render_html_document(&events)
}

/// 渲染 Markdown (支持数学公式)
#[command]
pub fn render_markdown_math(content: String) -> String {
    render_markdown_with_math(&content)
}

/// 提取 TOC 目录
#[command]
pub fn extract_toc(content: String) -> Vec<TocItem> {
    use pulldown_cmark::{Parser, Options, Event};

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);

    let parser = Parser::new_ext(&content, options);
    let mut toc = Vec::new();
    let mut line_num = 0;

    for event in parser {
        match event {
            Event::Start(pulldown_cmark::Tag::Heading(level)) => {
                // 需要收集标题文本
            }
            Event::Text(text) if !toc.is_empty() => {
                // 填充标题文本
            }
            Event::End(pulldown_cmark::TagEnd::Heading(level)) => {
                // 完成标题收集
            }
            Event::SoftBreak | Event::HardBreak => {
                line_num += 1;
            }
            _ => {}
        }
    }

    toc
}
```

### 4.2 前端 IPC 调用

**src-web/scripts/ipc.js**：
```javascript
/**
 * IPC 通信封装模块
 * 提供与 Tauri Rust 后端通信的统一接口
 */

const { invoke } = window.__TAURI__.core;

export const Ipc = {
  /**
   * 打开文件
   * @param {string} path - 文件路径 (可选，不传则显示对话框)
   * @returns {Promise<FileResult>}
   */
  async openFile(path) {
    if (!path) {
      path = await invoke('select_file');
      if (!path) return null;
    }
    return await invoke('open_file', { path });
  },

  /**
   * 保存文件
   * @param {string} path - 文件路径 (可选，不传则显示对话框)
   * @param {string} content - 文件内容
   * @returns {Promise<FileResult>}
   */
  async saveFile(path, content) {
    if (!path) {
      path = await invoke('select_save_path');
      if (!path) return null;
    }
    return await invoke('save_file', { path, content });
  },

  /**
   * 渲染 Markdown 到 HTML
   * @param {string} content - Markdown 内容
   * @param {boolean} enableMath - 是否启用数学公式
   * @returns {Promise<string>} HTML 内容
   */
  async renderMarkdown(content, enableMath = false) {
    const command = enableMath ? 'render_markdown_math' : 'render_markdown';
    return await invoke(command, { content });
  },

  /**
   * 提取 TOC 目录
   * @param {string} content - Markdown 内容
   * @returns {Promise<TocItem[]>}
   */
  async extractToc(content) {
    return await invoke('extract_toc', { content });
  }
};

export default Ipc;
```

### 4.3 Tauri 入口注册

**src-tauri/src/main.rs**：
```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{file, editor, render};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            file::open_file,
            file::save_file,
            file::select_file,
            file::select_save_path,
            render::render_markdown,
            render::render_markdown_math,
            render::extract_toc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 5. 关键功能实现方案

### 5.1 打开 .md 文件

**实现流程**：
```
用户操作 → Tauri 文件对话框 → 选择路径 → IPC 调用 → Rust 读取文件 → 返回内容 → 前端渲染
```

**前端代码** (src-web/scripts/editor.js)：
```javascript
import { Ipc } from './ipc.js';

class Editor {
  constructor() {
    this.currentPath = null;
    this.sourceText = '';
    this.isSourceMode = false;
  }

  async openFile() {
    const result = await Ipc.openFile();
    if (result && result.success) {
      this.currentPath = result.path;
      this.sourceText = result.content;

      // 渲染到预览区
      const html = await Ipc.renderMarkdown(result.content, true);
      this.renderPreview(html);

      // 更新 TOC
      this.updateToc(result.content);

      // 更新窗口标题
      document.title = `${this.getFileName()} - Typora Next`;
    }
  }

  getFileName() {
    if (!this.currentPath) return 'Untitled';
    return this.currentPath.split(/[/\\]/).pop();
  }
}
```

### 5.2 侧边 TOC (目录大纲)

**实现方案**：

1. **Rust 端**：解析 Markdown 提取标题层级
2. **前端端**：渲染 TOC 侧边栏，点击跳转

**TOC CSS** (src-web/styles/toc.css)：
```css
.toc-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 250px;
  height: 100vh;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  padding: 16px;
}

.toc-item {
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s;
}

.toc-item:hover {
  background: var(--color-bg-tertiary);
}

.toc-item[data-level="1"] { font-weight: 600; }
.toc-item[data-level="2"] { padding-left: 16px; }
.toc-item[data-level="3"] { padding-left: 32px; font-size: 0.9em; }
.toc-item[data-level="4"] { padding-left: 48px; font-size: 0.85em; }

.toc-item.active {
  background: var(--color-accent);
  color: white;
}
```

**TOC JS** (src-web/scripts/toc.js)：
```javascript
export class TocSidebar {
  constructor(container) {
    this.container = container;
    this.items = [];
  }

  async update(content) {
    this.items = await Ipc.extractToc(content);
    this.render();
  }

  render() {
    this.container.innerHTML = this.items.map(item => `
      <div class="toc-item"
           data-level="${item.level}"
           data-slug="${item.slug}"
           data-line="${item.line}">
        ${item.text}
      </div>
    `).join('');

    // 点击跳转
    this.container.querySelectorAll('.toc-item').forEach(el => {
      el.addEventListener('click', () => {
        const slug = el.dataset.slug;
        this.scrollToHeading(slug);
      });
    });
  }

  scrollToHeading(slug) {
    const heading = document.querySelector(`[data-slug="${slug}"]`);
    if (heading) {
      heading.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
```

### 5.3 源码/预览切换

**实现方案**：
- 使用同一个编辑器容器
- 通过 CSS class 切换显示模式
- 源码模式：直接显示 Markdown 文本
- 预览模式：显示渲染后的 HTML

```javascript
class ViewToggle {
  constructor(editorElement, previewElement) {
    this.editor = editorElement;
    this.preview = previewElement;
    this.isSourceMode = false;
  }

  toggle() {
    this.isSourceMode = !this.isSourceMode;

    if (this.isSourceMode) {
      this.editor.style.display = 'block';
      this.preview.style.display = 'none';
    } else {
      this.editor.style.display = 'none';
      this.preview.style.display = 'block';
    }
  }

  // 快捷键处理
  setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + / 切换源码模式
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        this.toggle();
      }
    });
  }
}
```

### 5.4 快捷键处理

**Tauri 全局快捷键** (使用 tauri-plugin-global-shortcut)：

**Cargo.toml 添加**：
```toml
tauri-plugin-global-shortcut = "2"
```

**Rust 端注册快捷键**：
```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

fn setup_shortcuts(app: &tauri::AppHandle) {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyS);

    app.global_shortcut().register(shortcut).unwrap();

    app.global_shortcut().on_shortcut(shortcut, |app, shortcut| {
        // 发送事件到前端
        app.emit("shortcut-save", ()).unwrap();
    });
}
```

**前端监听快捷键事件**：
```javascript
import { listen } from '@tauri-apps/api/event';

// 监听 Rust 端发送的快捷键事件
listen('shortcut-save', (event) => {
  editor.saveFile();
});

listen('shortcut-open', (event) => {
  editor.openFile();
});

// 或在前端直接处理 (简单场景)
document.addEventListener('keydown', (e) => {
  // Ctrl+S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    editor.saveFile();
  }

  // Ctrl+O 打开
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    editor.openFile();
  }

  // Ctrl+/ 切换源码
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    editor.toggleView();
  }
});
```

---

## 6. WebView 渲染集成

### 6.1 前端入口页面

**src-web/index.html**：
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Typora Next</title>
  <link rel="stylesheet" href="./styles/main.css">
  <link rel="stylesheet" href="./styles/editor.css">
  <link rel="stylesheet" href="./styles/toc.css">
</head>
<body>
  <div class="app-container">
    <!-- TOC 侧边栏 -->
    <aside id="toc-sidebar" class="toc-sidebar"></aside>

    <!-- 主编辑区 -->
    <main class="editor-main">
      <!-- 工具栏 -->
      <header class="toolbar">
        <button id="btn-open">Open</button>
        <button id="btn-save">Save</button>
        <button id="btn-toggle">Source</button>
      </header>

      <!-- 源码编辑区 -->
      <textarea id="source-editor" class="source-editor" style="display: none;"></textarea>

      <!-- 预览渲染区 -->
      <article id="preview-area" class="preview-area"></article>
    </main>
  </div>

  <!-- KaTeX 支持 -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>

  <!-- Prism.js 代码高亮 -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>

  <!-- 应用脚本 -->
  <script type="module" src="./scripts/main.js"></script>
</body>
</html>
```

### 6.2 前端构建配置

**package.json**：
```json
{
  "name": "typora-next-web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-fs": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0"
  }
}
```

**vite.config.js**：
```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src-web',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
```

---

## 7. 依赖安装清单

### 7.1 系统依赖

| 依赖 | 安装命令 | 说明 |
|------|----------|------|
| Node.js | 已安装 (v22.18.0) | 前端构建必需 |
| npm | 已安装 (10.9.3) | 包管理器 |
| Rust | rustup-init.exe | 后端编译必需 |
| Tauri CLI | `npm install -g @tauri-apps/cli@latest` | Tauri 开发工具 |

### 7.2 Tauri 系统依赖 (Windows)

Tauri 在 Windows 上需要以下系统组件：
- Microsoft Visual Studio C++ Build Tools
- WebView2 (Windows 11 已内置)

安装命令：
```powershell
# 安装 VS Build Tools (如未安装)
winget install Microsoft.VisualStudio.2022.BuildTools

# WebView2 通常已内置，可验证
# 查看 C:\Program Files (x86)\Microsoft\EdgeWebView
```

### 7.3 npm 依赖

```powershell
cd "C:/CODE/open Typora"

# 初始化 package.json (如不存在)
npm init -y

# 安装开发依赖
npm install -D vite

# 安装 Tauri API
npm install @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/plugin-fs @tauri-apps/plugin-shell
```

### 7.4 Cargo 依赖

**src-tauri/Cargo.toml** 新增：
```toml
[dependencies]
tauri = "2"
tauri-build = "2"
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-global-shortcut = "2"  # 可选：全局快捷键
```

---

## 8. 实施计划建议

### 8.1 阶段划分

| 阶段 | 任务 | 优先级 | 预估时间 |
|------|------|--------|----------|
| P1 | 命令行核心功能完善 | 高 | (进行中) |
| P2-1 | Tauri 项目初始化 | 中 | 1 天 |
| P2-2 | IPC 基础通信搭建 | 中 | 1 天 |
| P2-3 | 文件打开/保存功能 | 中 | 1 天 |
| P2-4 | WebView 渲染集成 | 中 | 1 天 |
| P2-5 | TOC 侧边栏 | 低 | 0.5 天 |
| P2-6 | 源码/预览切换 | 低 | 0.5 天 |
| P2-7 | 快捷键系统 | 低 | 0.5 天 |

### 8.2 前置条件

在开始 Tauri 集成前，需完成：
1. P1 命令行功能完成并通过测试
2. 确认 Rust/Cargo PATH 配置正确
3. 安装 Tauri CLI 和系统依赖

### 8.3 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebView2 兼容性 | Windows 7/8 不支持 | 目标 Windows 10+ |
| Rust 环境配置 | 编译失败 | 使用 rustup 标准安装 |
| 前端构建复杂度 | 开发效率降低 | 使用 Vite 简化构建 |
| IPC 通信延迟 | 实时编辑体验 | 增量渲染优化 |

---

## 9. 参考资源

- Tauri 官方文档: https://tauri.app/v2/guide/
- Tauri GitHub: https://github.com/tauri-apps/tauri
- Vite 文档: https://vitejs.dev/
- pulldown-cmark 文档: https://docs.rs/pulldown-cmark/

---

## 附录 A: Tauri v2 API 快速参考

### A.1 核心命令宏

```rust
#[tauri::command]
fn my_command(arg: String) -> Result<String, String> {
    Ok(format!("Received: {}", arg))
}
```

### A.2 注册命令

```rust
.invoke_handler(tauri::generate_handler![
    my_command,
    another_command,
])
```

### A.3 前端调用

```javascript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke('my_command', { arg: 'test' });
```

### A.4 事件系统

**Rust 发送事件**：
```rust
app.emit('event-name', payload).unwrap();
```

**前端监听事件**：
```javascript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('event-name', (event) => {
    console.log(event.payload);
});
```

### A.5 文件对话框

```javascript
import { open, save } from '@tauri-apps/plugin-dialog';

const filePath = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
});

const savePath = await save({
    filters: [{ name: 'Markdown', extensions: ['md'] }]
});
```

---

**文档版本**: 1.0
**创建日期**: 2026-05-03
**状态**: 研究阶段，待 P1 完成后实施