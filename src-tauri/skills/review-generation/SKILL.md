---
name: review-generation
description: Generate review cards (quiz questions + key points) for each concept in a completed learning chapter. Use when the host prompts with chapter content and concept list. Outputs structured JSON only — does not write files.
---

# Review Card Generation

Generate objective quiz questions and key point summaries for each concept in a completed chapter. The output is used by the review system's spaced-repetition engine to test the learner's memory.

## When the host invokes this skill

The host's prompt will look like:

```
请使用 review-generation skill 为以下章节生成复习卡片。
- chapter_file: "01-diffusion-model.md"
- concepts: [{"id":"diffusion-markov","name":"扩散模型的马尔可夫链"},{"id":"noise-schedule","name":"噪声调度"},{"id":"reverse-denoising","name":"反向去噪"}]
- weak_concepts: ["diffusion-markov"]

请使用 Read 工具读取项目根目录下的 01-diffusion-model.md 获取章节内容，然后为每个 concept 生成复习卡片。
```

The host will provide the chapter file path and concept list. Use the Read tool to fetch chapter content from the project directory. Skill's job is to generate structured JSON output.

## Output Format

Output ONLY valid JSON in a code block:

```json
{
  "cards": {
    "<concept-id>": {
      "quiz_questions": [
        {
          "type": "choice",
          "question": "问题的完整表述，应考察对该概念核心要点的理解",
          "options": ["干扰项1", "干扰项2", "正确选项", "干扰项3"],
          "answer": 2
        }
      ],
      "key_points": [
        "简洁的重点提炼，每条一句话",
        "覆盖该概念最核心的 3-5 个知识点"
      ]
    }
  }
}
```

## Card Generation Rules

### Quiz Questions (2-3 per concept)
1. Each question must test a **distinct** aspect of the concept — avoid redundant questions
2. Options must be **plausible** — no obviously wrong distractors
3. The correct answer index (`answer`) is 0-based from the options array
4. Prefer conceptual understanding over fact recall: "Why does X work?" over "What is X?"
5. If `weak_concepts` includes this concept, add 1 extra question focused on the most commonly misunderstood aspect

### 选择题质量硬约束（MANDATORY — 历史数据 91.5% 的题正确项在 0 位，长度比均值 3.3 倍，此节为根治）
1. **位置随机**：正确项在 options 数组中的位置必须随机（0-3 均匀），禁止习惯性放首位。一批卡片里 4 个位置都要出现。
2. **长度均衡**：最长选项与最短选项的字数比 ≤ 1.8；正确项不得明显比干扰项更长更详细。
3. **正确项不照抄**：正确项用自己的话改写，不得整句粘贴章节原文或 key_points 原文。
4. **干扰项是合理陷阱**：基于常见误解/易混概念，让没掌握的人真会选；禁止一眼荒谬的选项（如"法国立法规定皇室必须使用铝器"）。
5. **盲选自检**：生成后捂住 answer 只看选项——若凭长度/位置/措辞能猜对，或能瞬间排除两项以上，必须重写该题。

### Key Points (3-5 per concept)
1. Each key point should be **self-contained** — readable without the chapter context
2. Use specific terminology from the chapter, not vague generalities
3. Include the core intuition, the mechanism, and why it matters
4. If the concept is in `weak_concepts`, add a "常见误区" (common misconception) as the last key point

### General Rules
- Output ONLY the JSON — no explanations, no extra text outside the code block
- Every card must have at least 2 quiz questions and 3 key points
- Questions must be in Chinese (matching the chapter language)
- The chapter content provided by the host may be truncated — work with what you have
- Do NOT write any files — the host handles persistence
