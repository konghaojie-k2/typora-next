# AI 学习设计师 —— Sprint 实现计划

## 概述

将 Typora Next 升级为"AI 学习设计师"，分 4 个 Sprint 实现。

---

## Sprint 1：学习项目骨架（5 pts）

**目标**：用户可以创建学习项目，AI 生成可调整的学习大纲。

### 任务 1：前端 — 新建学习项目对话框
- **文件**：`dist/index.html`（添加模态对话框 DOM）、`dist/scripts/learning/project-manager.js`、`dist/styles/learning.css`
- **功能**：
  - 模态对话框：目标输入框、难度 radio（小白/有编程基础/专业进阶）、时长 select
  - "开始设计"按钮触发 AI 大纲生成
  - 大纲预览视图：可编辑的章节列表（编辑标题、删除、添加、拖拽排序）
  - 操作按钮："重新规划" / "开始生成"

### 任务 2：Agent SDK 桥接 — 大纲生成
- **文件**：`agent-bridge.js`
- **功能**：
  - 接收命令行参数：`stage=plan`、`goal`、`level`、`hours`、`project_path`
  - 调用 Claude Agent SDK 生成结构化大纲
  - 输出 JSON lines：`{"type": "outline", "data": {"chapters": [...]}}`
  - Prompt 工程：要求输出 chapters[]，每项含 title、duration_minutes、concepts[]

### 任务 3：Rust — 启动 Agent 子进程
- **文件**：`src-tauri/src/ai_agent.rs`（新建）、`src-tauri/src/lib.rs`（修改）
- **功能**：
  - `spawn_agent()`：用 `std::process::Command` 启动 Node.js 子进程
  - 读取 stdout JSON lines，解析为 `AgentMessage`
  - 通过 `app_handle.emit("agent-event", msg)` 转发到前端
  - 新增 Tauri command：`plan_course(goal, level, hours)`

### 任务 4：前端 — 事件监听与大纲展示
- **文件**：`dist/scripts/learning/project-manager.js`
- **功能**：
  - 监听 `agent-event` Tauri 事件
  - 解析 `outline` 类型消息，渲染章节列表
  - 用户编辑后保持修改状态
  - 点击"开始生成"调用 Rust 进入生成阶段

**验证标准**：
- [ ] 用户可以打开对话框，输入目标，选择难度和时长
- [ ] 点击"开始设计"后，Agent 生成大纲并展示
- [ ] 大纲可以编辑调整（标题、顺序、增删）
- [ ] 点击"重新规划"重新生成大纲
- [ ] 点击"开始生成"进入 Sprint 2

---

## Sprint 2：增量生成 + 后台预生成（8 pts）

**目标**：用户确认大纲后，AI 逐章生成学习文档，后台预生成下一章，用户反馈影响后续章节。

### 任务 1：Agent SDK 桥接 — 逐章生成
- **文件**：`agent-bridge.js`
- **功能**：
  - 实现 `stage=generate`，接收 `outline` JSON 和 `project_path`
  - 逐章调用 Agent SDK 生成 Markdown
  - 每章生成内容必须包含 `!concept`、`!question`、`!quiz` 学习元素
  - 每章完成后输出：`{"type": "chapter_complete", "data": {"index": N, "file": "..."}}`
  - 中间输出进度：`{"type": "progress", "data": {"current": N, "total": M}}`
  - 支持接收 `feedback` 参数调整后续章节

### 任务 2：Rust — 进程管理与事件转发
- **文件**：`src-tauri/src/ai_agent.rs`
- **功能**：
  - 新增 `generate_chapters(project_path, outline)` command
  - 单章 60 秒超时检测
  - `abort_generation()` 强制终止子进程
  - 进程崩溃捕获，emit `agent-error` 事件
  - API Key 从配置读取，通过环境变量传给子进程

### 任务 3：前端 — 进度追踪
- **文件**：`dist/scripts/learning/progress-tracker.js`
- **功能**：
  - 监听 `agent-event`，更新章节状态
  - 章节状态：未生成 ⚪ / 生成中 🔄 / 就绪 ⏳ / 已完成 ✅
  - 文件树中章节图标根据状态变色
  - 底部进度条：`[======>    ] 3/8 章已就绪`
  - 后台预生成的章节显示 ⏳（就绪但未阅读）

### 任务 4：前端 — 章节阅读入口
- **文件**：`dist/scripts/learning/learning-renderer.js`
- **功能**：
  - 检测 `.learning/project.json` 存在时启用学习模式
  - 头部栏：项目名称 | 第 N/M 章 | 预计 X 分钟 | [标记完成 ✓]
  - 双击就绪章节打开阅读

### 任务 5：前端 — 学习模式状态机（UX 状态定义）

**文件**：`dist/scripts/learning/progress-tracker.js`、`dist/scripts/main.js`、`dist/styles/learning.css`

**背景**：Sprint 2 开发中发现，设计文档缺少"学习模式"与普通阅读模式的 UX 边界定义，导致用户进入学习项目后无法感知当前状态，也找不到退出路径。

**状态定义**：
- `idle`：普通阅读模式（未加载学习项目）
- `learning`：学习模式（项目已加载，进度面板可交互）

**状态转换**：

| 事件 | 从 | 到 | 副作用 |
|------|-----|-----|--------|
| 用户点击"开始学习" | idle | learning | 加载项目文件树、显示进度面板、toolbar 显示 🎓 badge |
| 用户点击"退出学习" | learning | idle | 清空 sidebar 文件树、关闭面板、移除 badge |
| 用户关闭面板（×） | learning | learning | 仅隐藏面板，不退出模式（文件树保留，可重新打开） |
| app 崩溃/重启 | any | idle | 下次启动从 `.learning/project.json` 恢复状态 |

**视觉区分**：
- `learning` 状态：toolbar 底部边框变紫色（`#4f46e5`）、右侧显示 🎓 学习模式 badge
- `idle` 状态：常规样式

**退出机制**：
- 进度面板 header 提供显式"退出"按钮（与 × 关闭面板区分）
- 退出后：sidebar 回到"未打开文件夹"空状态，已打开的章节 tab 保留（用户手动关闭）

---

**验证标准**：
- [ ] 确认大纲后，第 1 章开始生成
- [ ] 第 1 章完成后可打开阅读
- [ ] 阅读第 1 章时，后台预生成第 2 章
- [ ] 文件树中章节状态实时更新
- [ ] 进程崩溃/超时前端能收到错误提示
- [ ] 点击"中止"可以停止生成
- [ ] 进入学习项目后 toolbar 出现 🎓 标识
- [ ] 点击"退出"后 sidebar 清空、标识消失

---

## Sprint 3：学习模式渲染 + 测验（8 pts）

**目标**：用户在学习模式下阅读文档，完成章节测验，AI 评估掌握状态。

### 任务 1：前端 — 学习元素渲染
- **文件**：`dist/scripts/learning/learning-renderer.js`
- **功能**：
  - `!concept` → 交互概念卡片（黄色背景，悬停显示快速解释弹窗）
  - `!question` → 可点击展开的问题卡片（点击"查看解释"展开答案）
  - `!quiz` → 单选/多选测验 UI（选项卡片，选中高亮，提交按钮）
  - 学习元素在普通 Markdown 编辑器中显示为普通 callout

### 任务 2：前端 — 章节末掌握检查
- **文件**：`dist/scripts/learning/learning-renderer.js`
- **功能**：
  - 每章最后自动附加"掌握了吗？"区域
  - 调用 Rust `generate_quiz()` 生成 3-5 道测验题
  - 用户作答后提交

### 任务 3：Rust — 测验评估
- **文件**：`src-tauri/src/lib.rs`、`src-tauri/src/ai_agent.rs`
- **功能**：
  - 新增 `evaluate_quiz(chapter, questions, answers)` command
  - 调用 Agent SDK 评估答案（或走直接 LLM API 作为降级）
  - 返回评级：mastered / learning / struggling
  - 更新 `project.json` 中的概念掌握状态
  - 返回 `{"type": "quiz_result", "data": {"rating": "...", "weak_concepts": [...]}}`

### 任务 4：测验反馈 → 调整后续章节
- **文件**：`agent-bridge.js`、`dist/scripts/learning/progress-tracker.js`
- **功能**：
  - 测验结果发送给 Agent（`feedback` 参数）
  - 如果评级为 `struggling`，Agent 在后续章节前插入"加餐"章节
  - 如果评级为 `mastered`，Agent 可以跳过重复内容，加快进度
  - 前端显示"AI 已根据你的测验结果调整后续内容"

### 任务 5：前端 — 深化讲解
- **文件**：`dist/scripts/learning/learning-renderer.js`
- **功能**：
  - 复用现有批注系统
  - 选中文本后，批注工具栏增加"AI 解释"按钮
  - 调用 Rust `explain_selection(text, context)`
  - AI 返回深入浅出的解释，渲染为弹窗

**验证标准**：
- [ ] 学习模式下 `!concept` 渲染为精美卡片
- [ ] `!quiz` 可以正常作答和提交
- [ ] AI 评估后显示 🟢🟡🔴 评级
- [ ] 掌握状态更新到 project.json
- [ ] struggling 时后续章节自动调整
- [ ] 选中批注后 AI 解释正常工作

---

## Sprint 4：进度追踪 + 知识图谱 + 遗忘曲线（5 pts）

**目标**：用户查看学习进度和概念掌握状态，系统根据遗忘曲线推送复习。

### 任务 1：Rust — 状态读写与知识图谱构建
- **文件**：`src-tauri/src/lib.rs`
- **功能**：
  - `read_project_state(project_path)`：读取 project.json
  - `write_project_state(project_path, state)`：写入 project.json
  - `build_knowledge_graph(project_path)`：扫描所有章节，提取概念和依赖关系，写入 knowledge-graph.json

### 任务 2：前端 — 知识图谱 Tab
- **文件**：`dist/scripts/learning/progress-tracker.js`、`dist/index.html`
- **功能**：
  - 左侧 sidebar 新增"知识图谱" Tab，与"文件树"、"目录 TOC" 并列
  - 读取 `knowledge-graph.json`，转换为 Mermaid `graph TD` 语法
  - 复用现有 Mermaid 渲染管道
  - 节点颜色映射掌握状态：
    - `#4caf50` mastered（绿）
    - `#ff9800` learning（黄）
    - `#f44336` struggling（红）
    - `#9e9e9e` not_started（灰）
  - 点击节点跳转到对应章节
  - 图例：🟢已掌握 🟡学习中 🔴有困难 ⚪未开始

### 任务 3：前端 — 进度面板
- **文件**：`dist/scripts/learning/progress-tracker.js`
- **功能**：
  - 项目级进度：已完成 X/Y 章，掌握 Z 个概念，用时 N 小时
  - 概念列表：每个概念的掌握状态、所属章节
  - "重置进度"按钮（确认后清空所有状态）
  - "导出学习报告"按钮（生成 Markdown 总结）

### 任务 4：Rust — 遗忘曲线提醒
- **文件**：`src-tauri/src/lib.rs`
- **功能**：
  - 记录每章完成时间戳
  - 应用启动时检查复习时间点：1天、3天、7天、30天
  - 推送"快速复习"通知：
    - 抽取错题（从 quiz-history.json）
    - 抽取关键概念卡片
    - 预计 5 分钟完成
  - 复习完成后更新下次提醒时间

### 任务 5：边界处理
- **文件**：多处
- **功能**：
  - 用户编辑 AI 生成文档 → 文件头部插入 `<!-- user_modified: true -->`，AI 不重写
  - Agent 生成失败 → 章节标记 `failed`，显示重试按钮
  - Agent SDK 未安装 → 降级为直接调用 LLM API（前端 fetch，功能受限但可用）
  - 大纲生成后用户大幅调整 → 支持手动拖拽重新排序，Agent 根据新顺序重新计算依赖

**验证标准**：
- [ ] 知识图谱 Tab 正常显示，节点可点击跳转
- [ ] 进度面板显示正确的掌握统计
- [ ] 遗忘曲线在 1天/3天/7天触发复习提醒
- [ ] 用户编辑的文档不会被 AI 覆盖
- [ ] Agent SDK 未安装时有降级提示和替代方案

---

## 技术依赖总览

| 组件 | Sprint | 新增文件 |
|------|--------|---------|
| Agent SDK 桥接 | 1-2 | `agent-bridge.js` |
| Rust Agent 管理 | 1-2 | `src-tauri/src/ai_agent.rs` |
| 前端项目管理 | 1 | `dist/scripts/learning/project-manager.js` |
| 前端进度追踪 | 2, 4 | `dist/scripts/learning/progress-tracker.js` |
| 前端学习渲染 | 2-3 | `dist/scripts/learning/learning-renderer.js` |
| 样式 | 1-3 | `dist/styles/learning.css` |

## 新增 Tauri Commands

| Command | 参数 | 返回 | Sprint |
|---------|------|------|--------|
| `plan_course` | goal, level, hours | Result<(), String> | 1 |
| `generate_chapters` | project_path, outline | Result<(), String> | 2 |
| `abort_generation` | - | Result<(), String> | 2 |
| `evaluate_quiz` | chapter, questions, answers | Result<QuizResult, String> | 3 |
| `explain_selection` | text, context | Result<String, String> | 3 |
| `read_project_state` | project_path | Result<ProjectState, String> | 4 |
| `write_project_state` | project_path, state | Result<(), String> | 4 |
| `build_knowledge_graph` | project_path | Result<(), String> | 4 |

## Tauri Events

| Event | 方向 | 数据 | Sprint |
|-------|------|------|--------|
| `agent-event` | Rust → 前端 | AgentMessage (JSON) | 1-2 |
| `agent-error` | Rust → 前端 | { message: String } | 1-2 |
| `quiz-result` | Rust → 前端 | QuizResult | 3 |
| `review-reminder` | Rust → 前端 | { project: String, concepts: [...] } | 4 |
