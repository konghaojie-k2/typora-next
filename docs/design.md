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
