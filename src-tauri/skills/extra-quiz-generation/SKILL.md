---
name: extra-quiz-generation
description: Generate quiz questions from saved Cornell explanation cues (concept + Q&A history). Use when the host invokes "请用 extra-quiz-generation skill 根据以下概念列表生成附加题" with a JSON list of concepts and their Q&A histories. Writes the result to disk using the Write tool.
---

# Extra Quiz Generation Skill

Generate single-choice quiz questions from the user's saved Cornell explanation cues. Each cue represents a concept the user highlighted and asked about while reading.

## Input

The host's prompt will contain a JSON list of concepts:

```json
[
  {
    "concept": "位置编码",
    "qa_history": [
      {"q": "位置编码", "a": "位置编码给每个 token 加一个位置向量..."},
      {"q": "为什么用正弦余弦？", "a": "因为正弦余弦函数具有周期性和连续性..."}
    ]
  }
]
```

Each entry has:
- **`concept`** — the user's highlighted term (concept name)
- **`qa_history`** — Q&A pairs starting with the initial explanation (Q0/A0), then follow-up Q&As

## 文件格式（写入 output_file）

用 `Write` 工具将以下 JSON 数组写入 prompt 中指定的 `output_file` 路径：

```json
[
  {
    "id": "extra_1",
    "qtype": "single",
    "question": "关于「位置编码」，以下哪项描述最准确？",
    "options": [
      {"label": "A", "text": "一个合理的错误选项（基于常见误解）"},
      {"label": "B", "text": "另一个合理的错误选项"},
      {"label": "C", "text": "位置编码用自己的话改写后的正确描述，长度与干扰项相近"},
      {"label": "D", "text": "第三个合理的错误选项"}
    ],
    "correct": "C",
    "weak_concepts": ["位置编码"]
  }
]
```

## Rules
1. **Based on Q&A history for each concept**: Use the actual explanation content from `qa_history` to construct the correct option — **paraphrased in your own words, NOT copy-pasted**（历史数据曾出现正确项整段粘贴解释原文 100+ 字、干扰项仅 12 字）。正确项的 label 位置必须随机（A-D 均匀），禁止固定放 A。The initial explanation (Q0/A0) and follow-up Q&As provide rich material.

2. **Distractor quality**: Options B/C/D must be **plausible but incorrect**. Draw from:
   - Common misconceptions about this concept
   - Confusion with related concepts in the same domain
   - Partially correct statements with a key error
   Do NOT use generic distractors like "这是一种数据压缩算法".

3. **One question per concept**: Generate exactly one question for each concept in the input list. Do not skip any.

4. **Question phrasing**: The question stem should be specific to the concept. Vary the phrasing:
   - "关于「{concept}」，以下哪项描述最准确？"
   - "以下关于「{concept}」的说法，正确的是？"
   - "对于「{concept}」，下列理解正确的是？"

5. **题型**: Only `"qtype": "single"` (single choice). `correct` is a single string like `"A"`.

6. **weak_concepts**: Always include the concept name.

7. **id format**: `extra_1`, `extra_2`, etc. — sequential starting from 1.

### 选择题质量硬约束（MANDATORY）
1. **长度均衡**：最长选项与最短选项的字数比 ≤ 1.8；正确项不得明显比干扰项更长更详细。
2. **正确项不照抄**：正确项是对 `qa_history` 解释的改写提炼，不得整段粘贴原文。
3. **干扰项是合理陷阱**：基于常见误解/易混概念；禁止跨领域胡扯（如"数据压缩算法""前端 UI 框架"）。
4. **盲选自检**：生成后捂住 correct 只看选项——若凭长度/位置/措辞能猜对，或能瞬间排除两项以上，必须重写该题。
