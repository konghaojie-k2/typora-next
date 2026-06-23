# Review Card Format Specification

## Overview

Review cards are stored in `.learning/review-cards.json`, a global file keyed by concept ID. Each card contains quiz questions and key points for spaced-repetition review.

## JSON Schema

```json
{
  "version": "1.0",
  "cards": {
    "<concept-id>": {
      "concept_name": "显示用概念名",
      "source_chapter": "01-chapter-file.md",
      "quiz_questions": [
        {
          "type": "choice",
          "question": "问题的完整表述",
          "options": ["正确选项", "干扰项1", "干扰项2", "干扰项3"],
          "answer": 0
        }
      ],
      "key_points": [
        "简洁的重点提炼，每条一句话"
      ],
      "generated_at": "2026-06-22T10:21:00",
      "from_weak": false
    }
  }
}
```

## Field Rules

### `quiz_questions[]`
- `type`: always `"choice"` (only supported question type)
- `question`: full Chinese sentence, ends with `？`
- `options`: exactly 4 strings, one correct + three distractors
- `answer`: 0-based index into `options`, integer

### `key_points[]`
- 3-5 strings per concept
- Each string: one self-contained sentence in Chinese
- No markdown formatting inside strings

### `from_weak`
- `true` if this concept was in `weak_concepts` during generation
- `false` otherwise
- Used by the review system to prioritize weak concepts
