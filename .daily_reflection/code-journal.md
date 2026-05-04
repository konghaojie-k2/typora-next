# Code Journal - typora-next

> 每日三省记录：早省（计划）、中省（执行）、晚省（复盘）

---

## 2026-05-03

### 早省
- **计划**: 完成 P0 核心渲染功能
- **任务**: T-001~006
- **状态**: 已完成 ✅

### 中省
- **时间**: 14:00
- **完成操作**:
  - Agent-1 完成代码块增强（高亮、行号、复制按钮）
  - Agent-2 完成数学公式渲染（行内、块级）
  - 验证测试样本渲染效果
- **涉及文件**:
  - `src/core/renderer/mod.rs`
  - `src/core/syntax/mod.rs`
  - `src/main.rs`
  - `tests/samples/*.md`

### 晚省
- **时间**: 22:14
- **总览**: 一日两阶段全速推进，从空仓到桌面 GUI

**今日完成**:
- ✅ Phase 1（P0 核心渲染）100% — T-001~006
  - Markdown → HTML 渲染管线
  - Prism.js 代码高亮 + 行号 + 复制按钮
  - KaTeX 行内/块级数学公式
- ✅ Phase 2（P1 扩展功能）100% — T-007~014
  - Mermaid 13 种图表（流程图、时序图等）
  - 本地/网络图片加载 + Lightbox 放大
  - Tauri 桌面应用集成（GNU toolchain + junction 解决路径空格）
  - 侧边目录 TOC + Ctrl+E 源码模式切换
- 🐛 修复：Mermaid HTML 实体解码问题

**今日提交**（10 个）:
| 时间 | Hash | 内容 |
|------|------|------|
| 12:30 | b441aca | 项目骨架 + 功能设计 |
| 13:48 | b11ebf5 | 21 个 PBI 入库 |
| 13:56 | 91f6648 | PBI-001 基础渲染 |
| 14:15 | acdde23 | P0 阶段完成（T-001~006）|
| 14:18 | 466cacc | task_plan + daily-reflection 引入 |
| 14:32 | da4e5dd | Phase 2 批量推进（T-007~012）|
| 15:46 | 4cb1a4f | 修复 Mermaid HTML 实体 |
| 15:51 | fa1e682 | Tauri 桌面应用集成 |

**未提交修改**（12 文件）:
- `CLAUDE.md`、`task_plan.md`：进度同步
- `dist/index.html`、`dist/scripts/main.js`、`dist/styles/main.css`：前端持续优化
- `src-tauri/*`：Tauri 配置 + Rust 代码
- `tests/samples/full.md`：测试样本扩展
- 删除：`sample.html`、`sample.md`（被 `tests/samples/` 取代）

**新发现**:
1. Tauri 在 Windows 路径含空格时 GNU toolchain 的 `dlltool.exe` 会失败 → 用 junction point 绕过
2. Mermaid 内部需要 HTML 实体解码（pulldown-cmark 把 `<>` 编码后导致 Mermaid 解析失败）
3. 13 种 Mermaid 图表类型可通过统一前端集成搞定，不必逐类处理

**明日建议**:
- 决定 Phase 3 起点：项目文件树（T-015）或多标签 Tab（T-017）
- 把今天的 12 个未提交文件按主题拆分提交
- 给 Tauri 应用做一次完整冒烟测试（打开 .md → 切源码 → TOC 跳转）

---

## 发现记录

1. pulldown-cmark 支持 GFM 扩展，无需额外处理表格/任务列表
2. 数学公式需要预处理保护，用占位符替换后再解析
3. Prism.js line-numbers 插件需要给 `<pre>` 添加 `class="line-numbers"`
4. Tauri Windows 路径空格问题：用 junction point 解决（`New-Item -ItemType Junction`）
5. Mermaid 在 pulldown-cmark 流水线中需 HTML 实体解码才能正确渲染