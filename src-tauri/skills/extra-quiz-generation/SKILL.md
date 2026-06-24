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
      {"label": "A", "text": "位置编码给每个 token 加一个位置向量，让 Transformer 能区分序列顺序"},
      {"label": "B", "text": "这是一个合理的错误选项（基于常见误解）"},
      {"label": "C", "text": "另一个合理的错误选项"},
      {"label": "D", "text": "第三个合理的错误选项"}
    ],
    "correct": "A",
    "weak_concepts": ["位置编码"]
  }
]
```

## Rules
1. **Based on Q&A history for each concept**: Use the actual explanation content from `qa_history` to construct Option A (the correct answer). The initial explanation (Q0/A0) and follow-up Q&As provide rich material.

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
