# Sprint 6 Backlog: AI 解释改造为"验证式学习助手"

> 来源: docs/design.md（2026-06-08 架构决策）
> Sprint 容量: 13 点（个人项目）
> 周期: 2026-06-08 ~ 2026-06-16

---

## Sprint 目标

将 Sprint 3 的单次 modal AI 解释，升级为带上下文的 Cornell 侧栏 + 追问累积 + 持久化 + 章节末测联动。

---

## PB Items（用户价值切片）

### PB1: 用户选中不懂的文字得到 AI 解释 + 推荐追问

**用户价值**: 阅读学习材料时，不懂的词/句能立即得到解释，并知道可以追问什么方向。

**验收标准**:
- [x] 选词 ≥2 字自动触发，不需要点按钮
- [x] 侧栏实时出现 cue（loading → active）
- [x] 解释包含课程/章节上下文（不是孤立解释）
- [x] 解释附带 3-4 个推荐追问 chip
- [x] LLM 响应非 JSON 时降级，不报错给用户
- [x] 后端用 Rust 直调 LLM（ureq），不 spawn node

**涉及模块**:
| 模块 | 文件 | 状态 |
|------|------|------|
| 纯函数模块 | `dist/scripts/explain-conversation.js` | ✅ 完成 |
| 侧栏 UI | `dist/scripts/learning/mode-integration.js` | ✅ 完成 |
| LLM 调用 | `src-tauri/src/ai_agent.rs::explain_selection_v2` | ✅ 完成 |

**Story Points**: 5 点（前端 2 + 后端 3）

---

### PB2: 用户点 chip 或自由输入追问，答案原地累积

**用户价值**: 对同一个概念能深入追问多轮，历史记录不丢失、不弹新窗口。

**验收标准**:
- [x] 点 chip → 同 cue 内 append Q&A
- [x] 自由输入 → 同 cue 内 append Q&A
- [x] 追问时 LLM 知道前情（previousQA）
- [x] tab 切换时 cue 列表清空，侧栏保持可见
- [x] 后端 explain_selection_v2 支持 previousQA 参数

**涉及模块**:
| 模块 | 文件 | 状态 |
|------|------|------|
| 追问 UI | `dist/scripts/learning/mode-integration.js` | ✅ 完成 |
| LLM 调用 | `src-tauri/src/ai_agent.rs::explain_selection_v2` | ✅ 完成 |

**Story Points**: 3 点（前端 1 + 后端 2）

---

### PB3: 用户的 AI 解释自动保存到本章记录

**用户价值**: 解释不随页面关闭而丢失，下次打开同一章还能看见之前问过的问题。

**验收标准**:
- [x] 解释完成后自动（或用户点保存）写入 `.learning/explanations/<chapter>.json`
- [x] 切换回已解释过的章节，cue 列表自动恢复
- [x] 文件格式符合 design.md §5.1 数据契约
- [x] 单章 cue 上限 20 条，超出提示清理

**涉及模块**:
| 模块 | 文件 | 状态 |
|------|------|------|
| 写持久化 | `src-tauri/src/ai_agent.rs::persist_explanation` | ✅ 完成 |
| 读持久化 | `src-tauri/src/ai_agent.rs::load_chapter_explanations` | ✅ 完成 |
| 前端恢复 | `dist/scripts/learning/mode-integration.js` | ✅ 完成 |

**Story Points**: 3 点（后端 2 + 前端 1）

---

### PB4: 章节末测针对用户问过的问题出附加题

**用户价值**: 测验不只是随机出题，而是针对"用户主动问过"的薄弱概念重点测试。

**验收标准**:
- [x] quiz 生成时读取 `explanations/<chapter>.json`
- [x] 如果本章有 ≥1 条 cue，附加 1-2 题
- [x] 附加题概念来自 `selectedText` 字段
- [x] 不影响原有 quiz 流程和评分逻辑

**涉及模块**:
| 模块 | 文件 | 状态 |
|------|------|------|
| Quiz 生成 | `src-tauri/src/ai_agent.rs::generate_chapter_quiz` | ✅ 完成 |

**Story Points**: 2 点（后端 2）

---

## 模块映射总览

```
┌─────────────────────────────────────────────────────────────┐
│  JS 前端（已完成）                                            │
│  - explain-conversation.js（纯函数: prompt/parse/hash）        │
│  - mode-integration.js（Cornell Sidebar + cue 管理 + 追问 + 持久化） │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Rust 后端（已完成）                                          │
│  - explain_selection_v2   ← PB1 + PB2                        │
│  - persist_explanation / load_chapter_explanations ← PB3     │
│  - generate_chapter_quiz 改造 ← PB4                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Definition of Done

- [x] BDD scenarios 全绿（bdd-acceptance 层）
- [x] JS TDD 全绿（unit 层）
- [x] Rust test 全绿（`cargo test --test xxx`）
- [x] `cargo check` 无错误
- [x] 每个 PB 有对应 BDD 场景覆盖
- [x] UX 状态机检查：进入/退出/恢复路径明确
- [x] Release 编译通过（`cargo build --release`）

---

## 验收记录

- **2026-06-09** `cargo build --release` 成功（29MB，12:53 编译）
- **BDD** 40/40 ✅
- **Rust TDD** 21/21 ✅（explain 7 + persistence 6 + quiz PB4 8）
- **JS unit** 19/19 ✅
- **cargo check** 无错误 ✅
