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
- concepts: ["扩散模型的马尔可夫链", "噪声调度", "反向去噪"]
- weak_concepts: ["扩散模型的马尔可夫链"]
```

The host will include the chapter content (or a substantial excerpt) in the prompt. Skill's job is generated structured JSON output.

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
          "options": ["正确选项", "干扰项1", "干扰项2", "干扰项3"],
          "answer": 0
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
