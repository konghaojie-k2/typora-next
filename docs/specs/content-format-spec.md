# AI 学习设计师 — 内容格式规范

> 本文件定义 AI 生成章节的标准格式约束，是 `agent-bridge.js` generate stage 的 prompt 工程依据。
> 与实现计划（plan）分离，plan 只写"做什么"，本文件写"标准是什么"。

---

## 1. 写作风格要求

1. **深入浅出**：用生活化类比解释复杂概念
2. **逻辑连贯**：每章结尾引出下一章的内容（如果有）
3. **有自己的思考**：不仅罗列知识点，还要解释"为什么"
4. **适度总结**：关键概念后给出简洁总结
5. **可视化**：鼓励使用 Mermaid 图表、表格

---

## 2. Markdown 格式要求

- 使用标准 Markdown 语法
- 数学公式用 `$...$` 和 `$$...$$`
- 代码块标注语言

---

## 3. 每章必须包含的学习元素

| 元素 | 数量 | 语法 | 渲染行为 |
|------|------|------|---------|
| `!concept` 概念卡片 | ≥ 2 个 | `> [!concept] 标题\n> 内容` | 黄色背景，悬停显示快速解释弹窗 |
| `!question` 思考题 | ≥ 1 个 | `> [!question] 标题\n> 问题\n> > [!answer] 答案` | 可点击展开查看答案 |
| `!quiz` 自测题 | ≥ 1 个 | `> [!quiz]\n> 1. 题干\n>    - A. ...\n>    - B. ... ✓` | 阅读过程中的即时检查点 |

---

## 4. quiz.json 标准格式（v1）

### 4.1 生成时机

`generateChapters` 逐章生成时，每写完 `.md` 文件后，**同时**输出同名的 `.quiz.json`。

### 4.2 文件位置

```
project/
├── 00-课程介绍.md
├── 00.quiz.json          ← 和 .md 同目录、同名（仅扩展名不同）
├── 01-神经网络基础.md
├── 01.quiz.json
└── .learning/
```

### 4.3 JSON Schema

```json
{
  "$schema": "quiz.json.v1",
  "chapter_file": "01-神经网络基础.md",
  "chapter_title": "神经网络基础",
  "generated_at": "2026-06-04T10:30:00Z",
  "questions": [
    {
      "id": "q1",
      "qtype": "single",
      "question": "梯度消失和梯度爆炸分别出现在什么场景？",
      "options": [
        {"label": "A", "text": "梯度消失：深层网络+sigmoid；梯度爆炸：深层网络+大学习率"},
        {"label": "B", "text": "梯度消失：浅层网络+ReLU；梯度爆炸：深层网络+sigmoid"},
        {"label": "C", "text": "两者都只出现在 RNN 中"}
      ],
      "correct": "A",
      "weak_concepts": ["梯度消失", "激活函数选择"],
      "related_section": "3.2 反向传播的数值稳定性",
      "suggestion": "建议回顾 3.2 节关于激活函数的内容"
    },
    {
      "id": "q2",
      "qtype": "multiple",
      "question": "以下哪些措施可以缓解梯度消失？",
      "options": [
        {"label": "A", "text": "使用 ReLU 激活函数"},
        {"label": "B", "text": "增加网络层数"},
        {"label": "C", "text": "使用 Batch Normalization"},
        {"label": "D", "text": "使用残差连接（ResNet）"}
      ],
      "correct": ["A", "C", "D"],
      "weak_concepts": ["梯度消失", "BatchNorm", "残差连接"],
      "related_section": "3.3 缓解梯度消失的常用技巧",
      "suggestion": "BatchNorm 和残差连接是现代深度学习的标配"
    },
    {
      "id": "q3",
      "qtype": "short",
      "question": "用自己的话解释：为什么链式法则会导致梯度在深层网络中逐层衰减？",
      "options": [],
      "correct": null,
      "weak_concepts": ["链式法则", "梯度传播"],
      "related_section": "3.1 链式法则与反向传播",
      "suggestion": "试着用'多层传话筒'的类比来解释"
    }
  ],
  "adaptive_rules": {
    "mastered_threshold": 0.8,
    "learning_threshold": 0.5,
    "max_questions": 5
  }
}
```

### 4.4 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chapter_file` | string | ✅ | 关联的章节 Markdown 文件名 |
| `chapter_title` | string | ✅ | 章节标题 |
| `generated_at` | string | ✅ | ISO 8601 时间戳 |
| `questions` | array | ✅ | 测验题列表，3-5 题 |
| `questions[].id` | string | ✅ | 题号，如 q1/q2/q3 |
| `questions[].qtype` | string | ✅ | `single` 单选 / `multiple` 多选 / `short` 开放题 |
| `questions[].question` | string | ✅ | 题干 |
| `questions[].options` | array | 条件 | 单选/多选必填，开放题为空数组 |
| `questions[].options[].label` | string | ✅ | 选项标签：A/B/C/D |
| `questions[].options[].text` | string | ✅ | 选项内容 |
| `questions[].correct` | string/array/null | ✅ | 正确答案。single 为 `"A"`，multiple 为 `["A","C"]`，short 为 `null` |
| `questions[].weak_concepts` | array | ✅ | 答错本题暴露的薄弱概念列表 |
| `questions[].related_section` | string | ✅ | 关联章节段落，用于建议用户回顾 |
| `questions[].suggestion` | string | ✅ | 答错时的个性化建议 |
| `adaptive_rules` | object | ✅ | 评分阈值配置 |
| `adaptive_rules.mastered_threshold` | number | ✅ | 正确率 ≥ 此值判定为 mastered（默认 0.8） |
| `adaptive_rules.learning_threshold` | number | ✅ | 正确率 ≥ 此值判定为 learning（默认 0.5） |
| `adaptive_rules.max_questions` | number | ✅ | 最多出题数（默认 5） |

### 4.5 和 `!quiz` 块的关系

| | `!quiz`（章节内） | `quiz.json`（章末测验） |
|--|-------------------|------------------------|
| 目的 | 阅读过程中的**即时自测** | 章末的**综合掌握度评估** |
| 时机 | 阅读时遇到，随时自测 | 必须看完章节后，滚动到 80% 才出现 |
| 题型 | 简单直接（1-2 题） | 系统全面（3-5 题，覆盖全章） |
| 评估 | 无，用户自己对答案 | 系统评分，输出 mastered/learning/struggling |
| 是否同一套题 | **不一定**，可以不同 | 独立设计，更完整 |

---

## 5. 生成 Prompt 要求（待优化）

在 `generateChapters` 的 prompt 末尾追加：

```
每章生成完成后，同时输出两个文件：
1. {章节名}.md — 遵循"内容格式要求"和"学习元素数量要求"
2. {章节名}.quiz.json — 严格遵循 quiz.json v1 Schema

quiz.json 要求：
- 3-5 道测验题，覆盖本章核心概念
- 题型比例：单选 60% + 多选 20% + 开放题 20%
- 每题必须包含：correct 答案、weak_concepts、related_section、suggestion
```

---

## 6. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-04 | v1.0 | 初始版本，从实现计划抽离为独立规范文件 |
