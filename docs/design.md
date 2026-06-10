# [架构决策] Sprint 6 — AI 解释改造为"验证式学习助手"

> 整理自 2026-06-08 讨论

## 1. 背景

**当前状态**：
- `selection-explainer.js` + `mode-integration.js` + `ai_agent.rs::explain_selection` 三层架构
- 单次调用：选中文字 → spawn node 子进程 → 调 LLM → 返回 300 字解释 → modal 展示
- 解释**不持久化、不联动任何系统**

**核心问题**（来自 4 个 pending task + 用户讨论）：
1. Context 太薄：LLM 不知道课程目标/章节内容/已掌握概念
2. 速度慢：每次 spawn node 子进程（~500ms 冷启动）
3. Truncate：300 字硬截
4. UX：整段一起解释，无追问

**用户讨论后达成的核心论点**（关键 insight）：
> **深度学习 ≠ 掌握**。学习当时觉得"懂了"，没经过实践验证不算数。
> AI 解释 = 暴露（exposure），不是掌握（mastery）。掌握只能由 quiz 决定。

## 2. 约束

| 约束 | 来源 |
|------|------|
| 项目是 Learning Mode 阅读场景 | typora-next 定位 |
| BDD + TDD 强制流程 | CLAUDE.md |
| Rust + Tauri 2.x 技术栈 | 既有架构 |
| 现有复习系统按"艾宾浩斯 + quiz 弱概念"驱动 | review-scheduler.js |
| 状态机 status 字段（mastered/learning/struggling/not_started） | quiz-panel 流程 |
| 不能动 status 字段语义 | "status 只由 quiz 决定"是用户核心论点 |
| `explanations` 不能污染 `project.json` 主体 | 关注体积 |

## 3. 方案对比

### 3.1 存储位置

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 独立 `explanations.json`** | 简单 | 体积增长后读全文件慢 | ❌ |
| **B. 嵌 `project.json.concepts[name].explanations`** | 概念级聚合，跨章节关联 | 跨章节概念需先合并判断 | ❌ |
| **C. Per-chapter `.learning/explanations/<chapter>.json`** | 章节内独立、文件小、读快 | 不跨章节聚合 | ✅ |
| **D. 同时存 C + `project.json` 轻量引用** | 既能按章节读又能按概念聚合 | 写入原子性挑战 | 🔄 延后 |

**决定**：C（per-chapter），D 留 Sprint 7+ 再考虑。

### 3.2 与复习系统的关系

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 完全独立** | 干净 | 错过 struggling 信号 | ❌ |
| **B. 自动改 status** | 立即响应 | 信号模糊（深度 vs struggling） | ❌ |
| **C. 多次问 → 触发 quiz 验证** | 信号变成"该测了" | 需要 quiz 生成器读 AI 解释数据 | ✅ |
| **D. 用户显式 opt-in** | 0 误判 | 操作成本 | 🔄 备用 |

**决定**：C，原因是用户的核心论点"主观感觉 ≠ 掌握"——这要求**认真测**（多题、有干扰项），不是 1 题快测。

### 3.3 测试触发时机

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 立即测（1 题快测）** | 信号最强、不遗忘 | 打断阅读、1 题信噪比低 | ❌ |
| **B. 加到章节末测（1-2 题附加）** | 不打断、复用 quiz 流程、信号稳 | 信号衰减 | ✅ |
| **C. 加到下次复习** | 不打断 | 容易忘、跟复习节奏耦合 | ❌ |

**决定**：B。理由：用户的"深度学习 ≠ 掌握"论点要求认真测，章节末测是多题环境最合适。

### 3.4 速度优化

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 进程池/常驻 node** | 改造成本中等 | 复杂度高、需 IPC | ❌ |
| **B. Rust 直调 LLM（ureq）** | 路径最短、与 `fix_mermaid` 模式一致 | 失去 Agent SDK 工具调用 | ✅ |

**决定**：B。"解释"场景不需要工具调用（不像 plan_course/generate_chapters 要多步推理），ureq 单次 HTTP 完全够用。Sprint 5 的 `fix_mermaid` 已用此模式，可参考。

### 3.5 侧栏 UI 形态（Cornell Sidebar v2）

> **2026-06-09 修正**：本节原写 "Inline 浮层"（B），但 06-08 下午 2 小时内经过 3 版迭代
> （pb1-panel-v1-anchor-right / v2-smart-floating / v3-below-cursor → pb1-cornell-sidebar / v2），
> 最终选 Cornell 侧栏 v2。原 §3.5 表格的 B/C 项是过时的中间产物。

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. Modal（当前）** | 简单 | 遮挡上下文、不能多轮 | ❌ |
| **B. Inline 浮层**（v1-v3）| 不遮挡、原位展开 | 定位算法复杂；与原文分离感强 | ❌ |
| **C. 侧边栏**（v1）| 适合长对话 | 早期版本 cue 列表散乱，UX 弱 | ❌ |
| **D. Cornell Sidebar v2** | 永久显示、cue 列表与选词 1:1、复用康奈尔笔记心智模型 | 主内容压缩 180px | ✅ |

**决定**：D。Cornell Sidebar v2（`docs/prototypes/pb1-cornell-sidebar-v2.html`）：
- 永久侧栏，宽度 180px（v2 验证后从 360px 缩到 180px，避免主内容被挤太多）
- Cue 列表：每个选词生成一条 cue
- 3 状态流：empty（提示选词） / loading（黄色虚线 + ⏳） / active（实线 + 可追问）
- 每个 active cue 内置：术语 + 轮次标签 + 摘要 + 3 mini-chip + 自由输入栏
- 主内容区 `flex: 1` 自动压缩，不存在"遮挡"问题
- 选词即触发，无需开关

## 4. 最终选择

**Sprint 6 范围 = 8 个 MVP 项**：

1. **Rust 直调 LLM** — 仿 `fix_mermaid` 模式，新 `explain_selection_v2` 命令
2. **Context 增强** — prompt 加 `course_goal` / `chapter_summary` / `learned_concepts`
3. **Cornell 侧栏 v2** — 替代 modal，180px 永久侧栏 + cue 列表
4. **LLM 一次响应 = 解释 + 推荐追问** — JSON 输出结构化
5. **追问 = cue 内 Q&A 累积** — 点 chip / 输入 → 同 cue 内 append QA（不展开新浮层）
6. **Per-chapter 持久化** — `.learning/explanations/<chapter>.json`
7. **章节末测附加 1-2 题** — quiz 生成 prompt 读 AI 解释数据
8. **BDD + TDD** — 单元测试 + BDD 场景（6+）

**明确不做**（Sprint 7+ 候选）：
- 跨章节 "你之前问过" 提示
- 概念级聚合（project.json 嵌入）
- 状态机自动改 status
- 1 题快测
- 知识图谱节点标识

## 5. 接口契约

### 5.1 数据契约

**`explanations/<chapter>.json`**：
```typescript
type ChapterExplanations = {
  chapter: string;           // "05-positional-encoding.md"
  conversations: Array<{
    id: string;              // "conv-001"
    selectedText: string;    // "位置编码"
    anchor?: { paragraphIndex: number };  // 可选，定位回原文
    qaHistory: Array<{
      q: string;
      a: string;
      ts: string;            // "2026-06-08T12:35:00"
    }>;
    createdAt: string;
  }>;
};
```

### 5.2 Tauri 命令契约

| 命令 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `explain_selection_v2` | `{text, context, projectPath, chapterFile, previousQA?}` | `{explanation: string, suggestedQuestions: string[]}` | 单次问答 |
| `save_explanation` | `{projectPath, chapter, conversation}` | `void` | 持久化到 `explanations/<chapter>.json` |
| `get_chapter_explanations` | `{projectPath, chapter}` | `ChapterExplanations` | 读回用于 UI 渲染/quiz 生成 |

### 5.3 数据流

```
[用户选中文字]
  ↓
[Cornell 侧栏] ← 新增一条 cue（loading 黄色虚线）→ explain_selection_v2 响应
  ↓
[cue 变 active（实线）] 显示解释 + 3 mini-chip + 自由输入栏
  ↓
[用户点 chip 或输入] → cue 内 Q&A 累积 → explain_selection_v2(text, context, previousQA)
  ↓
[用户点 "✓ 保存"] → save_explanation(conversation)
  ↓
[explanations/05-xxx.md.json 更新]
  ↓
[章节末测触发] → generate_chapter_quiz 读 explanations
  ↓
[quiz 含 1-2 题针对"用户问过"的概念]
  ↓
[quiz 提交] → status 按现状更新（mastered/learning/struggling）
```

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 输出不是合法 JSON | prompt 强调"返回合法 JSON" + 解析失败时降级（suggestedQuestions 用空数组 + 硬编码模板） |
| 侧栏挤压主内容（窗口窄） | 视口 ≤ 1024px 自动折叠为图标按钮，点击展开 |
| `explanations/<chapter>.json` 体积膨胀 | 后续可加章节级清理（保留最近 N 个） |
| quiz 生成的"附加题"质量 | prompt 给 LLM 看 `concepts_asked_about` 列表，LLM 自生成题目 |
| Tab 切换时 cue 状态错乱 | 切换 chapter 时清空当前 cue 列表，**不关闭侧栏**（侧栏永久存在）|
| 侧栏 cue 列表无上限导致长滚动 | v1 限制每章最多 20 条 cue，超出提示"清理历史"（PB3+ 候选）|
| AI 解释的 `text` 上限 200 字硬截 | 解释完成后由用户主动改字段（不强求放宽） |

## 7. 后续计划

### Sprint 6 实施步骤

**Stage 1（基础设施）**：
- `dist/scripts/explain-conversation.js` 纯函数模块
  - `buildExplainPrompt(text, context, learnedConcepts, previousQA)`
  - `parseExplainResponse(llmOutput)` → `{explanation, suggestedQuestions}`
  - `computeConceptHash(text)`
- Rust `explain_selection_v2`（ureq 直调）
- Rust `save_explanation` / `get_chapter_explanations`
- 修改 `generate_chapter_quiz` Rust 命令的 payload 加 `concepts_asked_about` 字段

**Stage 2（UI）**：
- `initCornellSidebar()` 替代 `showExplanationModal` 路径
- 侧栏组件：header（章节信息）/ body（cue 列表）/ footer（提示）
- cue 组件：术语 / 状态（loading-active）/ 摘要 / mini-chip / 自由输入栏
- 选词即触发：监听 `selectionchange` → 命中 ≥2 字的选区 → 创建新 cue

**Stage 3（BDD + TDD）**：
- `tests/unit/test_explain_conversation.js`
- `tests/features/sprint6_explain_conversation.feature`
- `tests/step_defs/sprint6_steps.js`
- `tests/bdd-acceptance/sprint6_*.steps.js`

### Sprint 7+ 候选

- 跨章节"你之前问过"提示（用 conceptHash 关联）
- 1 题快测（power user 开关）
- 概念级聚合（嵌 `project.json` 或 `concepts.json`）
- 知识图谱节点 💬 标识
- AI 解释的"探索模式"（不与 quiz 联动，纯粹是阅读助手）

## 8. 决策摘要（供 daily_reflection 引用）

- **存储**：per-chapter 文件 `.learning/explanations/<chapter>.json`
- **status 语义**：仅由 quiz 决定，AI 解释不触发 status 变更
- **测试触发**：多次问 AI → 章节末测附加 1-2 题（不打断阅读流）
- **速度**：Rust 直调 LLM（ureq），仿 `fix_mermaid` 模式
- **UI**：Cornell Sidebar v2（180px 永久侧栏，cue 列表）—— 见 `docs/prototypes/pb1-cornell-sidebar-v2.html`
- **关联反馈**：[[feedback_brainstorm_ux_gap]]（避免再陷入状态机缺失）

---

# [架构决策] Sprint 7 — OS 文件关联打开时任务栏注意力提醒

> 整理自 2026-06-10 讨论

## 1. 背景

**当前状态**：
- OS 文件关联打开 → 冷启动走 `lib.rs:2528-2544`、热启动走单实例插件 `lib.rs:2469-2478`
- 两条路径都发 `open-file-from-args` 事件到前端
- 前端 `main.js:227-238` 监听后 `invoke('open_file')` → `addTab`
- 整个链路**没有任何注意力提示**：用户在另一个窗口操作时，无法感知文件已被打开

**用户痛点**：
> 如果我的注意力不在阅读器上，我去资源管理器双击打开一个 md 文件时，是很难感知这个文件被打开了的。参考成熟的软件，在任务栏里的图标会有提醒，比如闪烁等用来提醒用户，文件被打开了

## 2. 约束

| 约束 | 来源 |
|------|------|
| Tauri 2.x 跨平台 API 自动适配 | `request_user_attention` 在 Windows 闪任务栏、macOS 弹 Dock、Linux 设 urgent hint |
| 不能误闪（用户在应用内拖拽/菜单打开） | 不能污染现有 `addTab` 路径 |
| 冷启动时窗口通常已获焦 → 闪烁无意义 | 闪烁必须基于实时焦点状态 |
| BDD + TDD 强制流程 | CLAUDE.md |
| 防御性错误处理 | 用户体验优先，不让边缘错误污染主流程 |

## 3. 方案对比

### 3.1 触发范围

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 仅 OS 文件关联打开** | 最小手术刀，不污染 `addTab` | 其它需要关注的场景（AI 完成、外部文件改动）暂不动 | ✅ |
| **B. 接入所有需注意事件** | 一致性好 | 改动面大、未明确范围 | ❌ YAGNI |

### 3.2 触发条件

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 仅 `is_focused() == false`** | 贴合 IM 软件行为 | — | ✅ |
| B. 加上 `is_minimized()` | 多覆盖边缘 | 与 A 几乎重合 | ❌ |
| C. 不判断，无条件闪 | 简单 | 冷启动冗余闪烁 | ❌ |

### 3.3 闪烁级别

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. Informational（闪一次）** | 体验克制，符合"双击 = 已有预期"场景 | — | ✅ |
| B. Critical（持续闪到点开） | 夺注意力 | 过度打扰 | ❌ |

### 3.4 决策落地方式

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 新增 Rust 命令 `notify_external_file_opened`，前端在 OS 路径上调用** | 命令语义清晰、可 mock 测试、可精准控制 | 多 1 次 IPC | ✅ |
| B. 直接在 Rust 单实例回调中闪烁 | 少一次 IPC | 冷启动路径不覆盖；前端无法控制时机 | ❌ |
| C. 新事件广播 | 解耦 | 不可控、不可测 | ❌ |

## 4. 最终选择

**架构**：保留现有 `open-file-from-args` 事件链路不变，在前端 `addTab` 成功之后，**追加**一次 `invoke('notify_external_file_opened')` 调用。Rust 端命令内部判断焦点，未聚焦时调用 `request_user_attention(Informational)`。

**数据流**：
```
OS 双击 .md
  ├─ 冷启动 → setup 钩子 500ms 后 emit ─┐
  └─ 热启动 → 单实例回调 emit ─────────┤
                                       ↓
                       前端 listen('open-file-from-args')
                                       ↓
                          invoke('open_file') → addTab
                                       ↓
                       invoke('notify_external_file_opened')  ← 新增
                                       ↓
                         Rust: window.is_focused() ?
                           false → request_user_attention(Info)
                           true  → noop
```

## 5. 接口契约

### 5.1 Rust 命令

```rust
fn should_request_attention(is_focused: bool) -> bool {
    !is_focused  // 防御性：is_focused 失败时按 false → 闪
}

#[tauri::command]
async fn notify_external_file_opened(window: tauri::Window) -> Result<(), String> {
    let focused = window.is_focused().unwrap_or(false);
    if should_request_attention(focused) {
        use tauri::UserAttentionType;
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
    Ok(())
}
```

- **无入参、无返回值**——前端不需要知道"闪没闪"
- `is_focused` 失败按 `false` 处理（保守宁可闪不可漏）
- `request_user_attention` 失败**吞掉**（不污染前端）

### 5.2 前端集成点

`dist/scripts/main.js:227-238` 监听器内，`addTab` 成功之后追加：

```js
invoke('notify_external_file_opened').catch(err =>
  console.warn('[Attention] notify failed:', err)
);
```

放在 `.then(result => { if (result && result.content) { addTab(...); <NEW> } })` 内部，**确保 `open_file` 失败时不调用 notify**（防误闪）。

## 6. 测试矩阵

| 层 | 文件 | 用例 |
|---|---|---|
| **Rust unit** | `src-tauri/tests/test_notify_external_open.rs`（新） | T1: `should_request_attention(true) == false`<br>T2: `should_request_attention(false) == true`<br>T3: 纯函数边界穷尽 |
| **JS unit** | `tests/unit/test_external_open_attention.js`（新） | U1: 收到事件 + open_file 成功 → 调 addTab + 调 notify<br>U2: 收到事件 + open_file 失败 → 调 addTab 失败，**不**调 notify<br>U3: 内部 addTab（拖拽）→ **不**经过此监听器，**不**调 notify |
| **BDD acceptance** | `tests/features/sprint7_taskbar_attention.feature`（新）<br>`tests/bdd-acceptance/sprint7_*.steps.js`（新） | B1: 应用前台时 OS 打开 → 任务栏不闪<br>B2: 应用最小化时 OS 打开 → 任务栏闪<br>B3: 应用内拖拽/菜单打开 → 任务栏不闪（边界） |

`mock-tauri.js` 需扩展：记录 `notify_external_file_opened` 调用次数与顺序。

## 7. 风险点 + 缓解

| 风险 | 缓解 |
|------|------|
| macOS Dock 弹跳比 Windows 任务栏闪更"重" | Informational 级别都是单次/短暂，参照系统 IM 默认行为 |
| `request_user_attention` 在 Linux 行为依赖 WM | 项目主要交付 Windows/macOS |
| 冷启动 500ms 延迟期间用户切走窗口 → 闪烁"过晚" | 500ms 是现有约束，闪晚比漏好 |
| `addTab` 内部去重（文件已打开）→ addTab 走 switchTab → notify 仍触发 | 正确：用户就是想知道"我刚双击的文件现在在哪个 tab" |
| 前端 notify 失败 → 不污染主流程 | `.catch(console.warn)` |

## 8. YAGNI 边界（明确不做）

- ❌ 关闭/最小化窗口时清除 attention 状态（Tauri 自动处理）
- ❌ 多个外部文件连续打开的合并闪烁（OS 自己去重）
- ❌ 用户可配置是否启用此行为

## 9. 决策摘要（供 daily_reflection 引用）

- **触发范围**：仅 OS 文件关联打开（`open-file-from-args` 事件）
- **触发条件**：`is_focused() == false`
- **闪烁级别**：`UserAttentionType::Informational`
- **决策点位置**：前端 `addTab` 成功之后调 `notify_external_file_opened`
- **可测性**：决策抽成纯函数 `should_request_attention(bool) -> bool`
- **错误处理**：`is_focused` 失败 → 按未聚焦处理；`request_user_attention` 失败 → 吞掉
- **平台适配**：依赖 Tauri `request_user_attention` 跨平台映射（Windows 闪/macOS 弹/Linux urgent）

---

# [架构决策] Sprint 8 — Socratic 复习（多概念体系巩固）

> 整理自 2026-06-10 讨论

## 1. 背景

**现有复习体系**（Sprint 4）：
- 艾宾浩斯调度 `review-scheduler.js`（按 `next_review_at` 触发）
- 单概念多选 quiz `quiz-panel.js`
- `status` 字段：`mastered / learning / struggling / not_started`
- 设计原则（已固化为不变量）：**"主观感觉 ≠ 掌握，只有 quiz 能改 status"**（docs/design.md Sprint 6 决策）
- 知识图谱 `knowledge-graph-manager.js`：节点 + 边，**表达结构但没表达"关系是什么"**

**用户痛点 + 洞察**：
> 知识图谱只是表达了关系，但是没有表达到底**是什么关系**。能不能加个中期的复习模式，用 AI 追问让用户自己阐述概念之间"是什么关系"？多知识点体系巩固用。

→ 现有 quiz 是单概念、单题、客观题；缺一个**多概念、主观阐述、AI 追问**的"中期体系巩固"模式。

## 2. 约束

| 约束 | 来源 |
|------|------|
| "quiz 是 status 唯一变更者"不变量 | Sprint 6 决策（用户核心论点） |
| 概念选材必须有 KG 语义 | 用户洞察"用图说关系" |
| 题目数和顺序由 AI 动态决定（非预设） | 苏格拉底方法本质 |
| 不污染 `project.json`、不复用 quiz-history.json | 物理隔离 |
| LLM 调用成本可接受（与 `explain_selection_v2` 同量级） | 现有监控数据 |
| BDD + TDD 强制流程 | CLAUDE.md |

## 3. 方案对比

### 3.1 触发时机

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 事件驱动：完成 N 次 quiz 后推荐** | 与 quiz 节奏耦合、不打扰、有成就感 | N 阈值需调 | ✅ |
| B. 固定周期（每周一次） | 简单 | 不灵活 | ❌ |
| C. 用户主动入口 | 0 推送 | 容易忘 | ❌ |

### 3.2 概念选材

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. KG 集群（BFS from 最高度节点 + 强边过滤）** | 自然契合"用图说关系"洞察 | KG 稀疏时退化 | ✅ |
| B. 时间窗（最近 N 概念） | 简单 | 与"体系巩固"初衷弱 | ❌ |
| C. LLM 自由选材 | 灵活 | 不可复现/难调 | ❌ |

### 3.3 Status 影响

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 不改 status，不动 review_count，只记 last_socratic_at** | 与 Sprint 6 原则 100% 一致 | — | ✅ |
| B. 引入 LLM 质量评估 | 信号丰富 | 主观信号进状态机，违原则 | ❌ |
| C. 用户自评 1-5 星 | 显式 | 操作成本 | ❌ |

### 3.4 对话保存

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| **A. 保存到 `.learning/socratic-sessions/<ts>.json`** | 未来可挖掘、复盘价值高 | 多 KB/次（可忽略） | ✅ |
| B. 不保存，只留 last_socratic_at | 简单 | 永久失去复盘能力 | ❌ |

### 3.5 UI 形态（4 候选 → V2 Notebook）

候选对比见 `docs/prototypes/sprint8-socratic-mockups.html`：

| 候选 | 进度表达 | KG 耦合 | 实现成本 | 决定 |
|------|---------|--------|---------|------|
| V1 Chat | "已 N 轮" | 仅 chip | 🟢 低 | ❌ |
| **V2 Notebook** | **无（隐式累积）** | **仅 chip** | **🟢 低** | **✅** |
| V3 Split KG | 节点覆盖 | 最高 | 🔴 高 | ❌（Sprint 9+ 再做） |
| V4 右侧栏 | 概念列表 | 中 | 🟡 中 | ❌ |

**决定 V2** 理由：实现成本最低、契合"复习"质感（像读书笔记）、不与 Sprint 7 视觉语言冲突。"无进度"恰好契合苏格拉底**题目数和顺序不可预设**的本质。V3 是最契合用户洞察的，但 KG 渲染是独立 Sprint 工作量，留 Sprint 9+。

## 4. 最终选择

**架构**：复用 Cornell Sidebar 风格的 LLM 追问流（不复制 Cornell Sidebar 本身，新建全屏 modal），事件驱动触发，KG 集群选材，独立 session 文件存档，**与 quiz 物理隔离**。

**数据流**：
```
用户完成第 N 次 quiz (mastered/learning)
  ↓
review-scheduler.js 检测 quiz_count_since_last_socratic ≥ N
  ↓
弹非阻塞 prompt：toast "要做次体系复习吗？"
  - 「开始」→ 启动 Socratic Modal（V2 Notebook）
  - 「稍后」→ 静默记录 last_dismissed_at（24h 内不再弹）
  - 「不再提醒」→ 永久 opt-out
  ↓
Socratic Modal：
  1. invoke('socratic_select_cluster', projectPath) → Rust BFS 选 4-6 概念
  2. invoke('socratic_chat', { messages, system_prompt_template }) → 流式 LLM 响应
  3. 多轮 Q&A，AI 自由决定追问/跳转/结束（输出 {done: true}）
  4. 结束 → invoke('socratic_save_session', { path, turns, end_reason })
  5. 关闭 → 更新 .learning/socratic-state.json 的 last_socratic_at
```

**关键不变量**：
- ❌ Socratic **绝不写** `project.json` 的 concept status
- ❌ Socratic **绝不写** `.learning/quiz-history.json`
- ✅ Socratic **只写** `.learning/socratic-state.json` 和 `.learning/socratic-sessions/<ts>.json`
- ❌ Socratic **不能把 mastered 概念打回 struggling**

## 5. 接口契约

### 5.1 Rust 命令

**`socratic_select_cluster`**（R1 概念选材）：
```rust
#[tauri::command]
async fn socratic_select_cluster(
    project_path: PathBuf,
    state: tauri::State<AppState>,
) -> Result<SocraticCluster, String>;
```

```rust
struct SocraticCluster {
    concepts: Vec<ConceptRef>,        // 4-6 个
    cluster_hash: String,             // 24h 去重
    edges: Vec<EdgeRef>,              // 概念间的边
}

struct ConceptRef { id: String, title: String, source_chapter: String }
struct EdgeRef   { from: String, to: String, weight: f32 }
```

**`socratic_chat`**（R2 多轮对话）：
```rust
#[tauri::command]
async fn socratic_chat(
    messages: Vec<ChatMessage>,        // 历史
    concept_titles: Vec<String>,      // 本场概念标题（拼到 system prompt）
) -> Result<SocraticResponse, String>;
```

```rust
struct ChatMessage     { role: String, content: String }  // "user" | "tutor"
struct SocraticResponse { 
    content: String,                  // tutor 回复文本
    done: bool,                       // AI 判断 session 该结束了
}
```

**`socratic_save_session`**（R3 落盘）：
```rust
#[tauri::command]
async fn socratic_save_session(
    project_path: PathBuf,
    session: SocraticSession,
) -> Result<String, String>;          // 返回落盘文件路径
```

```rust
struct SocraticSession {
    version: String,                  // "1.0"
    started_at: String,               // ISO
    concept_ids: Vec<String>,
    concept_titles: Vec<String>,
    turns: Vec<ChatMessage>,
    ended_at: String,
    end_reason: String,               // "llm_done" | "user_ended" | "abandoned"
}
```

**`socratic_load_state` / `socratic_save_state`**（R4 trigger 状态）：
```rust
struct SocraticState {
    last_socratic_at: Option<String>,
    last_dismissed_at: Option<String>,
    opt_out: bool,
    quiz_count_since_last_socratic: u32,
    recent_cluster_hashes: Vec<String>,  // 24h 内
}
```

### 5.2 纯函数（测试核心）

```rust
// KG 集群选择（BFS from 最高度节点 + 强边过滤）
fn select_socratic_cluster(
    nodes: &[KgNode], 
    edges: &[KgEdge], 
    target_size: usize, 
    min_edge_weight: f32,
) -> Vec<String>;

// 是否应该触发 prompt（事件驱动）
fn should_trigger_socratic(
    quiz_count_since: u32,
    threshold: u32,
    last_dismissed_at: Option<&str>,
    now: &str,                         // ISO
    opt_out: bool,
    last_socratic_at: Option<&str>,
    recent_hashes: &[String],
    current_hash: &str,
) -> TriggerAction;                    // Trigger | Silent | Postponed
```

### 5.3 前端集成点

`dist/scripts/learning/review-scheduler.js`：
- `onQuizComplete()` 内追加：累加 `quiz_count_since_last_socratic`，到阈值后调 `socratic_load_state` + `socratic_select_cluster` + 弹 toast prompt

`dist/scripts/learning/socratic-modal.js`（新建）：
- 入口：`openSocratic(cluster)` 启动 V2 Notebook modal
- 内部：调 `socratic_chat` 流式、渲染 notebook 卡片、结束时调 `socratic_save_session` + `socratic_save_state`

`dist/scripts/learning/socratic-trigger.js`（新建）：
- 触发 toast DOM（V0 简化版：复用现有 review-toast 样式）

### 5.4 文件布局

```
{project}/
  .learning/
    socratic-state.json                # 触发状态（极简）
    socratic-sessions/
      2026-06-10T11-30-00Z.json
      2026-06-17T11-30-00Z.json
      ...
```

## 6. 测试矩阵

| 层 | 文件 | 关键用例 |
|---|---|---|
| **Rust unit** | `src-tauri/tests/socratic_cluster_test.rs`（新） | T1: BFS 选最高度节点<br>T2: 强边过滤（weight ≥ 0.5）<br>T3: target_size 截断<br>T4: 空 KG → 空 cluster<br>T5: 概念 < 4 → 全返回<br>T6: cluster_hash 一致性 |
| **Rust unit** | `src-tauri/tests/socratic_trigger_test.rs`（新） | T7: quiz 计数达阈值 → Trigger<br>T8: 24h 内 dismissed → Postponed<br>T9: opt_out → Silent<br>T10: cluster hash 已存在 → Silent |
| **Rust integration** | `src-tauri/tests/socratic_chat_test.rs`（新） | I1: system prompt 包含概念列表<br>I2: 多轮历史正确拼接<br>I3: LLM `{done: true}` 解析<br>I4: 非 JSON 响应降级 |
| **JS unit** | `tests/unit/test_socratic_state.js`（新） | U1: state 文件 load/save roundtrip<br>U2: quiz 完成 +1 计数<br>U3: trigger 函数对各场景返回正确 action |
| **JS unit** | `tests/unit/test_socratic_modal.js`（新） | S1: notebook 卡片正确渲染<br>S2: 提交回答 → 调 socratic_chat<br>S3: 收到 done=true → 调 socratic_save_session<br>S4: 用户主动结束 → 二次确认 |
| **BDD acceptance** | `tests/features/sprint8_socratic_review.feature`（新）<br>`tests/bdd-acceptance/sprint8_socratic_review.steps.js`（新） | B1: 完成 N 次 quiz → 弹 prompt<br>B2: "开始" → 选 cluster → 开 modal<br>B3: 多轮对话 + 真实 LLM 响应<br>B4: **session 结束后 concept status 不变**（关键回归）<br>B5: session 文件落盘到正确路径<br>B6: "不再提醒" → 后续 quiz 完成不弹<br>B7: KG 稀疏 → 走 fallback |

## 7. 风险点 + 缓解

| 风险 | 缓解 |
|---|---|
| LLM 成本（~8k tokens/session） | 与 explain_selection 同量级 |
| LLM 不按 Socratic 风格追问（直接给答案） | system prompt 明确禁止 + Rust 校验首轮不出现"答案是..." |
| Cluster 选得不好（不相关的概念） | BFS + 强边过滤；Sprint 9+ 加用户反馈"题质量差" |
| Session 文件膨胀 | 手动清；Sprint 9+ 加自动归档 |
| 24h cluster 去重但用户想做新一组 | UI 加"换一组"按钮（force re-pick） |
| LLM done 误判 | 提示"只覆盖了 N/M 个概念，继续吗？" |
| 二次确认（避免误关） | ESC / 主动结束 / 关闭按钮全部走二次确认弹窗 |

## 8. YAGNI 边界（明确不做）

- ❌ KG 渲染（V3 留 Sprint 9+）
- ❌ "过往 Socratic 历史"查看 UI
- ❌ 跨 session 弱项挖掘
- ❌ Session 评分（1-5 星用户自评）—— 不入状态机
- ❌ Session 导出 markdown / 分享
- ❌ 多语言切换
- ❌ 多人协作 session
- ❌ LLM 表达质量评估反馈到 KG
- ❌ 自动归档 session 文件

## 9. 决策摘要（供 daily_reflection 引用）

- **形态**：AI 一问一答（V2 Notebook modal，无固定进度）
- **触发**：完成 N 次 quiz 后事件驱动 prompt
- **选材**：KG 集群（BFS + 强边 weight ≥ 0.5，4-6 概念）+ 24h 去重
- **Status 影响**：零（保 Sprint 6 不变量）
- **Session 存档**：`.learning/socratic-sessions/<ts>.json`（每场独立文件）
- **状态文件**：`.learning/socratic-state.json`（极简：last_socratic_at + 计数 + opt_out + recent_hashes）
- **物理隔离**：不写 `project.json`、不写 `quiz-history.json`
- **关键洞察**：题目数和顺序由 AI 动态决定（**无"X/Y"固定进度**）
