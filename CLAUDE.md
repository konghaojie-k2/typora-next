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

## Testing Standards (BDD + TDD)

本项目所有功能按 **Scrum + BDD + TDD** 流程开发。

### 目录结构

```
tests/
├── features/           # BDD Gherkin 场景
├── step_defs/          # BDD Step Definitions
├── integration/        # JS Integration Tests
├── e2e/                # CLI 端到端测试
├── unit/               # JS 单元测试
└── mock-agent-sdk/     # Mock Agent SDK

src-tauri/tests/        # Rust Integration Tests
```

### 开发顺序（强制）

1. 写 BDD feature 文件 → 2. 写 Step Definitions → 3. 写 TDD 测试 → 4. 运行测试（红）→ 5. 实现 → 6. 运行测试（绿）→ 7. BDD 验收

### BDD Step Pattern 规范

**禁止在 pattern 中写引号**：

```javascript
// ✅ 正确
steps.when('用户输入{string}', ...)
steps.when('点击第{int}章', ...)

// ❌ 错误  
steps.when('用户输入"{string}"', ...)
```

原因：`{string}` 自动匹配中英文引号，pattern 中写引号会导致双重匹配失败。

### TDD 规范

- **JS 测试**：使用 `tests/unit/test-runner.js`（原生 JS，零外部依赖）
- **Rust 测试**：使用 `tests/*_test.rs`（integration test 格式），主仓库运行：`cargo test --test xxx`
- **Mock**：Agent SDK 必须可注入，禁止硬编码 `require('@anthropic-ai/claude-agent-sdk')`

### 验收标准

一个 Sprint 完成当且仅当：
- [ ] BDD 场景全绿
- [ ] JS TDD 全绿
- [ ] Rust test 全绿（主仓库执行）
- [ ] `cargo check` 无错误

详细规范见 `tests/README.md`。

---

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

## Testing Standards (BDD + TDD)

本项目所有功能按 **Scrum + BDD + TDD** 流程开发。

### 目录结构

```
tests/
├── features/           # BDD Gherkin 场景
├── step_defs/          # BDD Step Definitions（内存模拟层）
├── bdd-acceptance/     # BDD 可用性验收测试（真实文件系统层）★ 新增
├── integration/        # JS Integration Tests
├── e2e/                # CLI 端到端测试
├── unit/               # JS 单元测试
└── mock-agent-sdk/     # Mock Agent SDK

src-tauri/tests/        # Rust Integration Tests
```

### 三层测试金字塔

```
┌─────────────────────────────────────────┐
│  单元测试（test_*.js）                    │ ← 验证逻辑对不对
│  - ChapterStatusManager 状态机           │
│  - ProjectList CRUD                      │
│  - generateFilename 纯函数               │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  验收测试（bdd-acceptance/）              │ ← 验证能不能用 ★ 关键
│  - 真实文件系统（Node.js fs）            │
│  - 真实前端模块（require 实际代码）       │
│  - 验证 Windows 路径 / ACL 权限          │
│  - 验证跨模块一致性（如文件名生成）       │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  手动验收（运行 app.exe 点一点）          │ ← 验证体验好不好
│  - 创建 → 导入 → 进入 → 阅读 全链路      │
└─────────────────────────────────────────┘
```

### 编译前必跑清单（强制）

**任何代码修改后，release 编译前必须依次执行：**

```bash
# 1. 单元测试（快速验证逻辑层）
cd tests/unit
node test_progress_tracker.js
node test_learning_hub.js
node test_project_resume.js

# 2. 可用性验收测试（真实文件系统）
cd tests/bdd-acceptance
node runner.js

# 3. Rust 编译检查
cd src-tauri
cargo check
```

**验收测试必须全绿才能编译。** 这是 Sprint 2 的教训：
> Sprint 1 只有内存模拟的 step definitions，没有真实文件系统验证，
> 导致 Windows 路径 bug、ACL 权限缺失、状态不同步等问题全部漏到 Sprint 2 才发现。

### BDD Step Pattern 规范

**禁止在 pattern 中写引号**：

```javascript
// ✅ 正确
steps.when('用户输入{string}', ...)
steps.when('点击第{int}章', ...)

// ❌ 错误  
steps.when('用户输入"{string}"', ...)
```

原因：`{string}` 自动匹配中英文引号，pattern 中写引号会导致双重匹配失败。

### TDD 规范

- **JS 测试**：使用 `tests/unit/test-runner.js`（原生 JS，零外部依赖）
- **Rust 测试**：使用 `tests/*_test.rs`（integration test 格式），主仓库运行：`cargo test --test xxx`
- **Mock**：Agent SDK 必须可注入，禁止硬编码 `require('@anthropic-ai/claude-agent-sdk')`

### 验收标准

一个 Sprint 完成当且仅当：
- [ ] BDD 场景全绿（bdd-acceptance 层）
- [ ] JS TDD 全绿（unit 层）
- [ ] Rust test 全绿（主仓库执行）
- [ ] `cargo check` 无错误
- [ ] **UX 状态机检查**（Sprint 2 教训）：
  - [ ] 功能有明确的进入/退出路径
  - [ ] 用户能感知当前所处状态（视觉标识或明确提示）
  - [ ] 异常退出后有恢复机制

---

## 上下文管理

本项目使用 **daily-reflection** skill 进行跨会话状态同步，数据存放在 `.daily_reflection/`：

- `context-sync.json` — 核心状态（进度、待办、活跃陷阱、最近文件）
- `decisions.md` — 决策记录（活跃区 + 归档区）
- `archive/` — 归档历史

**不再使用 project harness**（已移除 `.project/` 目录）。

### Worktree 与 daily-reflection 联动

**创建新 worktree 时，必须将 `.daily_reflection/` 替换为指向主仓库的符号链接**，否则 worktree 中的状态更新不会同步回主仓库：

```bash
# 在 worktree 根目录执行
rm -rf .daily_reflection
ln -s "$(git -C <主仓库路径> rev-parse --show-toplevel)/.daily_reflection" .daily_reflection
```

此规则确保所有 worktree 共享同一份 `context-sync.json` 和 `decisions.md`。
