---
name: explanation
description: Explain selected text from a learning chapter using analogies and plain language, then suggest follow-up questions for deeper understanding. Use when the host invokes "请用 explanation skill 解释" with a term, context, and optional previous Q&A history. Writes the result to disk using the Write tool.
---

# Explanation Skill

Use plain-language analogies and Socratic-style questioning to explain a concept from a learning chapter. The goal is **understanding, not completeness** — the user should walk away able to explain the concept in their own words.

## When the host invokes this skill

The host's prompt will look like:

```
请用 explanation skill 解释以下内容。
- text: "马尔可夫链"
- context: '{"chapterTitle":"前向扩散过程的数学建模","chapterGoal":"掌握前向过程的数学推导...","surroundingText":"...这叫做马尔可夫链..."}'
- previousQa: [...]
```

Parse these into variables:

- **`text`** — the selected term to explain.
- **`context`** — JSON string (optional) with:
  - `chapterTitle`: current chapter name
  - `chapterGoal`: chapter learning objective from the opening `> 本章目标：...`
  - `surroundingText`: paragraphs around the selected term in the chapter
- **`previousQa`** — prior Q&A history for follow-ups (optional).

## Explanation Rules

1. **Use an analogy first** (1-2 sentences).
2. **Always connect to chapter context** — 最重要规则。不要名词解释名词。必须把解释关联到:
   - 本章目标（`chapterGoal`）——这个词为什么在这一章里重要
   - 上下文（`surroundingText`）——这个词在周围文字里是什么意思
   - 课程关系——这个词跟前后概念有什么联系
3. **If `surroundingText` is empty, still use `chapterGoal`** to anchor the explanation.
4. **Stay concrete** — avoid abstract language. Inline technical terms.
5. **Handle `previousQa`** — build on existing conversation.

## 文件格式（写入 output_file）

用 `Write` 工具将以下 JSON 写入 prompt 中指定的 `output_file` 路径：

```json
{
  "explanation": "解释文本",
  "suggested_questions": [
    "追问1: 帮助用户进一步理解的相关问题",
    "追问2",
    "追问3"
  ]
}
```

## Format Rules

- `explanation`: plain Chinese text, no markdown formatting. 300-500 characters.
- `suggested_questions`: 2-4 questions. Each should check understanding or explore a related angle.
- **禁止半角双引号**：所有文本值（explanation、questions）内引用一律用中文全角引号「」或“”。半角 `"` 会让写出的 JSON 非法，导致解析截断（2026-08-11 实爆：回答被切成半句话）。
- 写入文件后输出一句话确认即可。
