# 项目执行日志

> 跨会话技术执行记录，按日期组织。

---

## 2026-05-04

### 早省计划

**时间**: 13:24

**今日目标**: 启动 Phase 3，完成 T-015（项目文件树）基础框架

**当前阶段**: Phase 3: P2 Project Management

**今日任务**:
1. T-015: 项目文件树 — 文件夹选择 + 侧边栏文件树 UI
2. （可选）T-017: 多标签 Tab — 如果 T-015 进展顺利

**相关文件**:
- `src-tauri/src/lib.rs` — 添加文件树遍历命令
- `dist/index.html` — 添加文件树侧边栏区域
- `dist/scripts/main.js` — 文件树渲染 + 点击打开文件
- `dist/styles/main.css` — 文件树样式

**建议**:
- 从 Rust 侧的文件遍历命令开始（`std::fs::read_dir`）
- 前端用递归 `<ul>` 渲染目录树
- 完成后更新 task_plan.md 状态

### 中省

**时间**: 13:40

**完成操作**:
- 实现 `open_folder_dialog` + `list_directory` Rust 命令（递归读取目录，过滤 .md 文件）
- 添加 `DirEntry` 结构体（name, path, is_dir, children）
- HTML 新增 `file-tree-sidebar`（位于 TOC 左侧，可独立折叠）
- JS 实现文件树渲染（递归 `<ul>`，支持目录折叠/展开，点击打开文件）
- 添加 Ctrl+Shift+O 快捷键打开文件夹
- CSS 添加文件树完整样式（header、toolbar、item、active 状态）
- 更新 task_plan.md: T-015 → In Progress

**涉及文件**:
- `src-tauri/src/lib.rs`
- `dist/index.html`
- `dist/scripts/main.js`
- `dist/styles/main.css`
- `task_plan.md`

---
