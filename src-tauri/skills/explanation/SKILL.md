---
name: explanation
description: Explain a user-selected concept in plain language, optionally with chapter context. Use when the host prompts "请使用 explanation skill 解释...". Returns a short markdown text (≤ 300 chars) — no JSON wrapper, host appends directly to a modal.
---

# Concept Explanation

Explain one concept that the user highlighted while reading. Short, direct, with an analogy.

## When invoked

Host prompt shape:

```
请使用 explanation skill 解释用户选中的概念。
- text: {the highlighted text, ≤ 200 chars}
- context: {chapter title or surrounding paragraph, optional}
- max_length: 300
```

The `max_length` defaults to 300 chars. Strict cap.

## Workflow

1. **Analyze** the concept: what is it, what does it do, why is it in this chapter
2. **Optional context lookup** (only if you need it): Glob `*.md` in the project root, read the chapter file that matches `context`
3. **Draft** the explanation in the output format below
4. **Self-check** length: count characters (Chinese: 1 char each, ASCII: 1 char each). If over `max_length`, trim the "Why it matters" line first

## Output format

Single markdown text, no JSON wrapper:

```markdown
**{concept}**: {one-sentence definition}.

{2-3 sentence elaboration with a real-life analogy the user already knows}.

**Why it matters**: {1 sentence linking to the chapter context if available, else to the broader topic}.
```

Optional follow-up questions (omit if no good ones come to mind):

```markdown

**可能想追问**:
- {question 1}
- {question 2}
- {question 3}
```

## Style rules

- **No opening fluff** — don't start with "想象一下..." or "这是一个有趣的问题". Go straight to the concept.
- **Analogy first** — open with something the user already understands (a familiar everyday thing)
- **No academic jargon** unless it's the term being explained
- **No lecture** — 3 sentences max per paragraph
- **No JSON** — pure markdown text

## Failure modes

- Concept is too vague to explain (e.g. just "this") → ask the user to select more specific text instead
- No project context and concept is unfamiliar → give a general explanation, note that chapter context would help
- Exceeds `max_length` → trim, never violate the cap
