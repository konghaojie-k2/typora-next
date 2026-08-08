---
name: typora-course-summary
description: Generate a theme-based slide summary (主题式幻灯片总结) for a completed learning course. Use when the host prompts "请使用 typora-course-summary skill 生成主题式幻灯片总结" with project_path and chapter list. Reads all chapter .md files, synthesizes 4-6 cross-chapter themes, and writes <project>/99-课程总结.md with `---` slide separators. Skill is read-only (except the one summary file it writes) and self-contained.
---

# Course Summary Generation

Generate a **theme-based slide summary** that recaps the whole course after the learner finishes every chapter. The output is a Markdown file that the host renders as a Reveal.js slideshow (each `---` block becomes one slide).

## When the host invokes this skill

The host's prompt will look like:

```
请使用 typora-course-summary skill 生成主题式幻灯片总结。
- project_path: /path/to/project
- 课程章节（按顺序）：
1. 为什么学这个
2. 前向过程：逐步加噪
3. 反向过程：去噪原理
```

Parse these into variables.

## Workflow

1. **Find the chapter files**: use `find` to list all `*.md` files in `{project_path}` root (skip `99-课程总结.md` itself if it already exists — it's the output).
2. **Read every chapter file** with `Read`. Skim for the core concepts, key analogies, and cross-chapter connections — you need the whole arc, not every detail.
3. **Synthesize 4-6 major themes** across chapters. This is a **summary**, not a per-chapter recap: cluster related chapters/concepts into themes, show how ideas build on each other, and surface the big takeaways.
4. **Write** the summary to `{project_path}/99-课程总结.md` with the structure below.

## Output structure (MANDATORY)

The file is a Reveal.js slide deck source. **Each slide is separated by a line containing exactly `---` (with a blank line before and after).**

**核心原则：少字多图。** 每张幻灯片都是「图 + 极简要点」，不是文章。严禁段落、严禁长句、严禁逐章复述。

````
# {课程名}

{一行 tagline，≤ 15 字}

---

## {主题一}

```mermaid
flowchart LR
  A[概念A] --> B[概念B] --> C[概念C]
```

- {要点 1，≤ 12 字}
- {要点 2，≤ 12 字}
- {要点 3，≤ 12 字}

---

## {主题二}

```mermaid
mindmap
  root((主题二))
    概念X
    概念Y
```

- {要点 1，≤ 12 字}
- {要点 2，≤ 12 字}

---

## 学习回顾

- {最重要知识点 1 名词}
- {最重要知识点 2 名词}
- {最重要知识点 3 名词}
````

### 每页硬约束（违反即重写）

1. **每个主题页必须有且仅有一个 mermaid 图**——把该主题的概念/关系可视化。图要简单（≤ 8 个节点），一次讲清一个关系。
2. **每页要点 ≤ 3 条，每条 ≤ 12 字**——只留关键词短语，禁止写成句子。
3. **封面**：`# 课程名` + 一行 ≤ 15 字的 tagline，仅此而已。
4. **学习回顾**：只列 3-5 个知识点**名词**（如 `扩散模型` / `噪声调度`），不写解释。
5. **全中文，无段落、无长句、无逐章复述、无页眉页脚编号说明。**

### Mermaid 图类型建议

- 主题内部概念如何构成 → `mindmap`
- 主题内部/跨主题的先后或因果 → `flowchart LR/TD`
- 对比关系 → 两三个分支的 `mindmap` 即可，别用大表格

### 何时可以多一两行字

- 只有该主题有一个**必须讲清、图表达不了**的关键概念时，可加一条带公式/名词的要点（仍 ≤ 12 字）。不要滥用。

## MUST-VERIFY checklist (run with Read before returning)

- [ ] File written at `{project_path}/99-课程总结.md`
- [ ] Contains a cover slide (`# ...`) as the first block
- [ ] Contains **at least 4 slide groups** separated by `---` (cover + 3+ themes or review)
- [ ] Every `---` separator has a blank line before and after it (so the host's explicit-mode parser recognizes it — a `---` glued to text is a Setext heading, not a slide break)
- [ ] Each theme slide starts with `## {主题名}`
- [ ] Content is **cross-chapter synthesis**, not a list of chapter titles
- [ ] Language is Chinese
- [ ] **少字多图**：每个主题页有且仅有一个 mermaid 图；全篇**无段落、无长句**；每页要点 ≤ 3 条且每条 ≤ 12 字（学习回顾页只列名词）
- [ ] Cover 页只有 `# 标题` + 一行 ≤ 15 字 tagline

## Tool usage

- **find**: locate chapter .md files
- **Read**: read chapter files + verify output
- **Write**: only `{project_path}/99-课程总结.md`
- **No Bash, no Edit** during this skill

## Failure modes

- **API rate limit / timeout**: return what you wrote so far; host decides to retry.
- **Write tool denied**: abort and ask host to re-init the session.
- **Chapter files missing**: if no chapter .md files are found, report this and stop — do not fabricate content.
