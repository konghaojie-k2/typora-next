# Task Plan - typora-next

> Markdown 预览器开发计划，按 Phase 组织任务进度追踪。

---

## Phase 1: P0 Core Rendering ✅ COMPLETE

**目标**: 实现基础 Markdown 渲染核心能力

**状态**: COMPLETE

**完成日期**: 2026-05-03

### Tasks

| ID | 任务 | 状态 | 完成日期 |
|----|------|------|----------|
| T-001 | 基础 Markdown 渲染 (md → HTML) | ✅ Done | 2026-05-03 |
| T-002 | 代码块高亮 (Prism.js) | ✅ Done | 2026-05-03 |
| T-003 | 代码块行号显示 | ✅ Done | 2026-05-03 |
| T-004 | 代码块复制按钮 | ✅ Done | 2026-05-03 |
| T-005 | 行内数学公式 ($...$) | ✅ Done | 2026-05-03 |
| T-006 | 块级数学公式 ($$...$$) | ✅ Done | 2026-05-03 |

**关键产出**:
- CLI 命令: `typora-next render input.md output.html`
- Prism.js 集成 (Tomorrow 主题 + 行号 + 复制)
- KaTeX 集成 (行内 + 块级公式)
- 测试样本: `tests/samples/` (6 个 .md 文件)

---

## Phase 2: P1 Extended Features 🔄 IN PROGRESS

**目标**: 扩展渲染能力 + 集成 Tauri 桌面应用

**状态**: IN PROGRESS (命令行功能完成，待集成 Tauri)

**当前任务**: T-012 (集成 Tauri 桌面 exe)

### Tasks

| ID | 任务 | 状态 | 依赖 | 备注 |
|----|------|------|------|------|
| T-007 | Mermaid 流程图渲染 | ✅ Done | - | 13 种图表类型 |
| T-008 | Mermaid 时序图渲染 | ✅ Done | T-007 | 复用 T-007 基础 |
| T-009 | 本地图片加载 | ✅ Done | - | 相对路径 + 占位符 |
| T-010 | 网络图片加载 | ✅ Done | - | lazy loading |
| T-011 | 图片放大查看 | ✅ Done | T-009, T-010 | Lightbox + 缩放 |
| T-012 | 集成 Tauri (桌面 exe) | ⏳ Pending | - | 方案已完成，待实施 |
| T-013 | 侧边目录 TOC | ⏳ Pending | T-012 | 需要 GUI |
| T-014 | 源码模式切换 | ⏳ Pending | T-012 | Ctrl+E 切换 |

**关键产出**:
- Mermaid.js 集成 (流程图、时序图等 13 种)
- 图片处理 (本地/网络 + Lightbox 放大)
- Tauri 集成方案文档 (`docs/tauri-integration-plan.md`)

**验收标准**:
- Mermaid: 流程图 + 时序图正确渲染为 SVG
- 图片: 本地 + 网络图片正确显示，点击可放大
- Tauri: 打开 .md 文件直接预览，有 GUI 窗口
- TOC: 自动生成目录树，点击跳转
- 源码切换: Ctrl+E 切换预览/源码视图

---

## Phase 3: P2 Project Management ⏸️ PENDING

**目标**: 项目级文档管理 + 导出功能

**状态**: PENDING

**依赖**: Phase 2 完成 (需要 Tauri GUI)

### Tasks

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| T-015 | 项目文件树 | ⏳ Pending | T-012 |
| T-016 | 文件搜索过滤 | ⏳ Pending | T-015 |
| T-017 | 多标签 Tab | ⏳ Pending | T-012 |
| T-018 | PDF 导出 | ⏳ Pending | T-012 |
| T-019 | Word 导出 (精美模式) | ⏳ Pending | T-012 |

---

## Phase 4: P3 Enhancement ⏸️ PENDING

**目标**: 锦上添花的高级功能

**状态**: PENDING

**依赖**: Phase 3 完成

### Tasks

| ID | 任务 | 状态 | 依赖 |
|----|------|------|------|
| T-020 | AI 修复 Mermaid | ⏳ Pending | T-007, T-008 |
| T-021 | 主题系统 (浅色/深色) | ⏳ Pending | T-012 |
| T-022 | 文件刷新提示 | ⏳ Pending | T-012 |

---

## Errors Encountered

| 时间 | 错误类型 | 尝试次数 | 解决方案 |
|------|----------|----------|----------|
| - | - | - | - |

---

## Decisions Log

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-05-03 | 使用 Prism.js 而非 highlight.js | Tomorrow 主题更美观，插件生态丰富 |
| 2026-05-03 | 使用 KaTeX 而非 MathJax | 渲染速度快 10x |
| 2026-05-03 | P0 后集成 Tauri，P1 开始有 GUI | 先验证核心渲染能力再加 GUI 包装 |

---

## Next Steps

**当前建议**: 集成 Tauri (T-012)，将命令行工具变成桌面应用

**预计工作量**:
- T-012 (Tauri 集成): 需要安装 Tauri CLI + 配置项目结构
- T-013~014: 依赖 T-012 完成

**Tauri 准备工作**:
1. 安装 Tauri CLI: `npm install -g @tauri-apps/cli@latest`
2. 参考: `docs/tauri-integration-plan.md`

---

## Progress Summary

| Phase | 进度 | 任务完成 |
|-------|------|----------|
| Phase 1 | 100% | 6/6 ✅ |
| Phase 2 | 75% | 6/8 🔄 |
| Phase 3 | 0% | 0/5 ⏸️ |
| Phase 4 | 0% | 0/3 ⏸️ |

**总体进度**: 12/22 = 55%