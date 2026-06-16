---
name: chapter-generation
description: Generate a complete learning chapter (Markdown + quiz.json + concepts.json) for one slot in a learning project outline. Use when the host prompts "请使用 chapter-generation skill 生成第 N 章" with chapter index/title/duration/concepts. Writes three files via the Write tool. Skill is read-only and self-contained — does not call other skills.
---

# Chapter Generation

Generate one chapter's full learning material: Markdown body, end-of-chapter quiz, and concept-dependency map.

## When the host invokes this skill

The host's prompt will look like:

```
请使用 chapter-generation skill 生成第 N 章。
- chapter_index: 2
- chapter_title: "反向过程：去噪原理"
- duration_minutes: 25
- concepts: ["前向过程", "噪声调度", "反向去噪"]
- project_path: /path/to/project
- previous_chapters: ["为什么学这个", "前向过程：逐步加噪"]
```

Parse these into variables. `chapter_index` is **0-based**; convert to 2-digit zero-padded (`02`) for filenames.

## Workflow

1. **Onboard** (only if you haven't already this session): use `project-onboarding` skill to read the project state. Skip if the user just said "ok" to onboarding.
2. **Read the format spec** at `{project_path}/.claude/skills/chapter-generation/references/content-format.md`. This is the canonical chapter format — your Markdown and quiz.json MUST follow it.
3. **Check if the target file already exists**: use `Glob` for `{project_path}/{NN}-*.md`. If found, **STOP** — the chapter was already generated. Report this and exit.
4. **Write three files** with the `Write` tool, in this order:
   - `{project_path}/{NN}-{title-slug}.md`
   - `{project_path}/{NN}-{title-slug}.quiz.json`
   - `{project_path}/{NN}-{title-slug}.concepts.json`
5. **MUST verify** every file you just wrote — see checklist below. If any item fails, fix the file and re-write before returning.
6. **Return** a one-line text confirmation: `第 N 章已生成: {title}, {M} 个测验题, {K} 个概念`

## Chapter structure template (FOLLOW THIS)

Each chapter must follow this structure, inspired by the `transformer` example:

```
# {NN}: {title}

> 预计阅读时间：{duration} 分钟
> 本章目标：一句话说明本章解决什么问题

---

## 1.1 {first concept title}

### {concept} 的核心直觉

Open with a **real-life analogy** (1-2 sentences) that anyone can relate to.
Then transition into the technical explanation.

{1-2 paragraphs of technical content with inline math}

```{language}
# Code example that illustrates the concept
```

### {a concrete metaphor or problem}

Extend the analogy into a **concrete scenario** that exposes the limitations
or tradeoffs of the current approach. Use a Mermaid diagram here.

> [!concept]
> **{Concept name}**
> {1-2 sentence definition with the analogy woven in}

---

## 1.2 {next concept title}

### {its core intuition}

...

### {a concrete example}

> 对比 table (MUST use markdown tables for comparison):

| Feature | Approach A | Approach B | Why |
|:---:|:---:|:---:|:---|
| ... | ✅ | ❌ | ... |

---

## 1.{N} 本章总结

Recap the chapter's arc (3-5 bullet points or short paragraphs).
End with a ONE-SENTENCE summary in a blockquote.

---

> [!question]
> **{thought-provoking question that requires synthesis, not memorization}**
>
> > [!answer]- 查看答案
> >
> > {detailed explanation with reasoning}

---

> [!quiz]
> **小测验**
>
> **1. {question}**
>
> **A.** {option 1}
> **B.** {option 2} ✓
> **C.** {option 3}
> **D.** {option 4}
>
> **2. {question}**
> ...
>
> > [!answer]- **查看答案**
> >
> > **1. B** — {explanation}
> > **2. A** — {explanation}

---

## 预告：第 {N+1} 章

{tantalizing preview that transitions from what was just learned to what's next}
```

## MUST-VERIFY checklist (run before returning)

Run through this with `Read` after writing. If anything fails, rewrite the file.

**Markdown file (`.md`):**

**Structure:**
- [ ] Sections are NUMBERED (`1.1`, `1.2`, ...) and follow the template above
- [ ] Each major section starts with a **real-life analogy** (no jumps straight into math)
- [ ] Contains at least one **Mermaid diagram** illustrating key concepts
- [ ] Contains at least one **comparison table** with pros/cons
- [ ] Contains a **代码示例** (Python pseudocode or similar)
- [ ] Ends with "本章总结" + "预告：第 N+1 章"
- [ ] Has at least one `---` horizontal rule between major sections

**Learning elements:**
- [ ] Contains ≥ 2 `> [!concept]` cards (yellow background, hover popup)
- [ ] Contains ≥ 1 `> [!question]` block (with `> > [!answer]` inside) — must be **synthesis-level**, not trivial
- [ ] Contains ≥ 1 `> [!quiz]` block (inline self-check with at least 3 multiple-choice questions)
- [ ] Quiz questions test **understanding**, not fact recall (avoid "what is X" — prefer "why does X happen" / "which scenario best illustrates X")

**Formatting:**
- [ ] All math uses `$...$` or `$$...$$` (not raw `\(...\)`)
- [ ] All code blocks have a language tag (e.g. ` ```python `, not just ` ``` `)
- [ ] Tables use proper markdown table syntax with alignment markers (`:---:`, `:---`, `---:`)

**Callout exact format (see callout-format-spec.md):**
- [ ] `[!question]` without `-` (default expanded); `[!answer]-` with `-` (collapsible)
- [ ] Answer title is plain text `查看答案`, no `**` bold
- [ ] Answer content indented with `> > ` (two levels), no extra "**答案：**" title inside
- [ ] Empty line (`> > `) after `> > [!answer]- 查看答案` before content
- [ ] Quiz options use `**A.**` format, NOT `- A.` list format
- [ ] Quiz answer inside `> > [!answer]- 查看答案` can include "**答案：B**" to mark correct option

**quiz.json file:**
- [ ] Top-level has `questions` field (array, **not missing — this is the #1 cause of host-side errors**)
- [ ] `questions` has 3–5 entries
- [ ] Every question has: `id`, `qtype` (single/multiple/short), `question`, `options`, `correct`, `weak_concepts`
- [ ] `options` is `[]` for `short` questions, otherwise has 2–4 entries with `label` (A/B/C/D) and `text`
- [ ] `correct` is `"A"`-style string for single, `["A","C"]` array for multiple, `null` for short
- [ ] Top-level also has `chapter_file`, `chapter_title`, `generated_at` (ISO 8601)
- [ ] Wrap the whole file as valid JSON (last char is `}`, no trailing comma)
- [ ] **No unescaped ASCII `"` inside string values** — if you use Chinese quotes `""` inside the text, they must be `“` / `”` (curly quotes) or `\"` (escaped), NOT bare ASCII `"`. A bare `"` inside a JSON string will cause `expected ',' or '}'` at that line.

**concepts.json file — exact format expected by Rust parser:**
```json
{
  "chapter": "00-生成模型与扩散模型.md",   // ← THIS FIELD IS REQUIRED (exact filename)
  "concepts": [                              // ← 缺少 chapter 字段会使 Rust 解析失败
    { "id": "generative-models", "name": "生成模型", "depends_on": [] }
  ]
}
```
- [ ] Top-level has `chapter` field (string, must be the **exact .md filename** e.g. `"01-反向过程.md"`)
- [ ] Top-level has `concepts` array
- [ ] Every concept has `id` (kebab-case English), `name` (Chinese display), `depends_on` (array of upstream IDs)

## Filename slug rules

Convert the chapter title to a kebab-like slug:
- Keep ASCII alphanumerics and Chinese characters (`一-鿿`)
- Replace everything else (spaces, punctuation, emoji) with `-`
- Collapse repeated `-`, trim leading/trailing `-`
- Examples: `注意力机制` → `注意力机制`, `Self-Attention 详解` → `Self-Attention-详解`, `Why?` → `Why`

## Tool usage

- **Write**: only for the 3 output files
- **Read**: for the content-format reference and any existing chapter files (style consistency)
- **Glob**: to check file existence
- **No Bash, no Edit** during this skill

## References (read when needed)

- **[content-format.md](references/content-format.md)** — full Markdown/quiz.json/concepts.json schema. READ THIS before writing.
- **[examples.md](references/examples.md)** — worked example of a complete chapter + quiz.json + concepts.json. Read if you want a concrete template to mirror.
- **[callout-format-spec.md](references/callout-format-spec.md)** — **EXACT** format for `[!question]`, `[!quiz]`, `[!answer]` callouts, including nesting, collapsible markers, and option formatting. Read this before writing the learning elements.

## Style continuity

After onboarding or after writing chapter 1, re-read the most recent `*.md` file in the project. Match its:
- Heading style (e.g., `## ` vs `# ` for sections)
- Mermaid conventions (sequence vs flowchart)
- Voice (casual vs formal)
- Length per section

Inconsistent style between chapters is jarring. Consistency matters more than variety.

## Failure modes

- **API rate limit / timeout**: stop, return what you wrote so far, let host decide to retry
- **Write tool denied**: usually means session has wrong permissions — abort and ask host to re-init session
- **Format spec changes mid-session**: read the spec again, don't cache
