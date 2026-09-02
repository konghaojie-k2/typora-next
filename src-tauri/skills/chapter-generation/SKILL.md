---
name: chapter-generation
description: Generate a complete learning chapter (Markdown + quiz.json + concepts.json) for one slot in a learning project outline. Template adapts by course type (technical / engineering / humanities / hybrid) — technical courses get code/math/flowcharts, engineering courses get real formulas/process flows/industrial instances and NO pseudocode, humanities courses get concrete works/timelines instead of filler pseudocode. Use when the host prompts "请使用 chapter-generation skill 生成第 N 章" with chapter index/title/duration/concepts. Writes three files via the Write tool. Skill is read-only and self-contained — does not call other skills.
---

# Chapter Generation

Generate one chapter's full learning material: Markdown body, end-of-chapter quiz, and concept-dependency map. **First decide the course type, then follow the matching template branch** (see 课程类型判定).

## When the host invokes this skill

The host's prompt will look like:

```
请使用 chapter-generation skill 生成第 N 章。
- chapter_index: 2
- chapter_title: "反向过程：去噪原理"
- duration_minutes: 25
- concepts: ["前向过程", "噪声调度", "反向去噪"]
- course_type: humanities        ← optional; may be absent for legacy projects
- project_path: /path/to/project
- previous_chapters: ["为什么学这个", "前向过程：逐步加噪"]
```

Parse these into variables. `chapter_index` is **0-based**; convert to 2-digit zero-padded (`02`) for filenames.

## 课程类型判定（生成前必须先做）

`course_type` ∈ {`technical`, `engineering`, `humanities`, `hybrid`}，决定下方模板取哪个分支：

1. **prompt 里带 `course_type`** → 直接采用，不要二次猜测。
2. **prompt 里没有**（旧项目）→ 从 `chapter_title` / `concepts` 推断：
   - 代码 / 框架 / 算法 / 模型 / 软件 / 机器学习类词汇（transformer、排序、API、梯度…）→ `technical`
   - **真实工业 / 过程工程类词汇**（电解、熔炼、冶炼、刻蚀、工艺、化工、材料、机械、冶金、反应、产线、设备、产能…）→ `engineering`
   - 作品 / 人物 / 历史 / 流派 / 欣赏 / 聆听 / 文学 / 哲学类词汇（巴赫、印象派、唐诗、美学…）→ `humanities`
   - 存在多种 → 按主体内容选；硬要兼顾 → `hybrid`
   - 常用工具：工程类课程看有没有**真实化学/热力学公式、真实工艺流程图、真实工业参数**（刻蚀气体配比、电解槽电压…）——有就是 `engineering`，不是 `technical`
   - 再用 `Glob` 看项目里已有的 `{NN}-*.md`，以既有章节的实际风格校准推断结果。
3. **一致性铁律**：同一门课程从头到尾只按一个类型生成。第 2 章起必须与已有章节的类型处理保持一致。

## Workflow

1. **Onboard** (only if you haven't already this session): use `project-onboarding` skill to read the project state. Skip if the user just said "ok" to onboarding.
2. **Read the format spec** at `{project_path}/.pi/skills/chapter-generation/references/content-format.md` (legacy fallback: `{project_path}/.claude/skills/chapter-generation/references/content-format.md`). This is the canonical chapter format — your Markdown and quiz.json MUST follow it. It may already be inlined in your session context; re-Read only if incomplete.
3. **Check if the target file already exists**: use `Glob` for `{project_path}/{NN}-*.md`. If found, **STOP** — the chapter was already generated. Report this and exit.
4. **Write three files** with the `Write` tool, in this order:
   - `{project_path}/{NN}-{title-slug}.md`
   - `{project_path}/{NN}-{title-slug}.quiz.json`
   - `{project_path}/{NN}-{title-slug}.concepts.json`
5. **MUST verify** every file you just wrote — see checklist below. If any item fails, fix the file and re-write before returning.
6. **Return** a one-line text confirmation: `第 N 章已生成: {title}, {M} 个测验题, {K} 个概念`

## Chapter structure — 通用骨架（所有类型必须遵守）

```
# {NN}: {title}

> 预计阅读时间：{duration} 分钟
> 本章目标：一句话说明本章解决什么问题

---

## 1.1 {first concept title}

### {concept} 的核心直觉

Open with a **real-life analogy** (1-2 sentences) that anyone can relate to.
Then transition into the explanation.

【类型特化元素插在这里——见下一节，按 course_type 选择】

### {a concrete metaphor or problem}

Extend the analogy into a **concrete scenario** that exposes the limitations
or tradeoffs of the current approach.

> [!concept]
> **{Concept name}**
> {1-2 sentence definition with the analogy woven in}

---

## 1.2 {next concept title}

### {its core intuition}

...

### {comparison}

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
> **B.** {option 2}
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

## 类型特化（填充上方骨架中的「类型特化元素」）

### technical（技术课）

- ≥ 1 个**代码示例**（带语言标签，illustrating the concept），放在核心直觉之后
- 内联数学 `$...$` / `$$...$$`，在真正有公式可写时使用
- ≥ 1 个 **Mermaid 图**，图型按下方选型表选（流程→flowchart、交互→sequence）

### humanities（人文课）

- **具体作品实例**取代代码示例，作为"落到实物"的载体，至少 1 处：
  - 音乐：曲目 + 乐章 + 可听的时间点（如《勃兰登堡协奏曲》第二首 第三乐章 2'30'' 处赋格主题的进入）
  - 美术/建筑：作品 + 年代 + 看点（如《夜巡》1642 年，光影的戏剧性）
  - 历史/文学：事件/文本 + 出处 + 具体细节
- **禁止凑数伪代码 / 伪数学**：不得为了满足模板而虚构"把年代判断写成函数"这类无人需要读的代码块。本章内容不涉及编程，就没有代码块。
- 数学公式仅在内容真需要时出现（如乐理中的频率比）
- 可视化**按内容形态选型**（见选型表）；mermaid 是可选的——对比表格本身就能满足视觉化需求，纯赏析小节可以没有任何图

### engineering（真实科学与工程 / 工业过程课）

- **真公式**取代代码，在真有化学/热力学/工艺公式时使用（Faraday 定律、槽电压、电流效率、比电耗、刻蚀速率…）`$$...$$`；**禁止凑数伪公式**（不虚构不存在的公式）。
- **真实工业实例**作为"落到实物"的载体，至少 1 处：
  - 设备/槽型/工艺：具体型号与结构（如 400kA 预焙阳极电解槽、容性耦合等离子体刻蚀机 CCP）
  - 工艺参数：实测可查的量（阳极电流密度、刻蚀气体配比 SF₆/C₄F₈、槽电压 4.1~4.3V、吨铝直流电耗）
  - 产地产能：真实工厂/产线规模（山东某铝厂、TSMC 某代工厂工艺节点）
- **禁止编程代码块 / 伪代码**：本章不涉及编程，就没有 ` ```lang ` 代码块；不要为满足模板虚构代码。可视化走下方选型表——工艺/物料流用 `flowchart LR`，设备/结构层级用 `flowchart TB`，行业演进才用 `timeline`。
- 对比用 markdown 表格（物料·能量衡算、电解 vs 化学还原、干法 vs 湿法刻蚀等）。

### hybrid（混合课）

按小节的概念属性选：计算/机制类小节用 technical 元素，赏析/脉络类小节用 humanities 元素。同一小节内不要混搭出不协调的组合。

## Mermaid 图示选型表（所有类型通用）

| 内容形态 | 图示类型 | 示例 |
|---|---|---|
| 时间演变 / 生平 / 历史脉络 | `timeline` | 巴赫的四个任职时期 |
| 分类体系 / 流派谱系 | `mindmap` 或 `flowchart TB` | 巴洛克音乐的宗教线 vs 世俗线 |
| 真实流程 / 因果链 | `flowchart LR` | 算法步骤、决策流程 |
| 交互 / 调用关系 | `sequenceDiagram` | 协议握手、API 调用 |
| 对比 | markdown 表格 | 不需要 mermaid |

**选型原则**：图示类型服务内容形态。把生平画成 flowchart、把分类画成 sequenceDiagram 都是形态错配。

## MUST-VERIFY checklist (run before returning)

Run through this with `Read` after writing. If anything fails, rewrite the file.

**通用项（所有类型）:**

**Structure:**
- [ ] Sections are NUMBERED (`1.1`, `1.2`, ...) and follow the 通用骨架 above
- [ ] Each major section starts with a **real-life analogy** (no jumps straight into math/jargon)
- [ ] Contains at least one **comparison table** with pros/cons
- [ ] Ends with "本章总结" + "预告：第 N+1 章"
- [ ] Has at least one `---` horizontal rule between major sections

**Learning elements:**
- [ ] Contains ≥ 2 `> [!concept]` cards (yellow background, hover popup)
- [ ] Contains ≥ 1 `> [!question]` block (with `> > [!answer]` inside) — must be **synthesis-level**, not trivial
- [ ] Contains ≥ 1 `> [!quiz]` block (inline self-check with at least 3 multiple-choice questions)
- [ ] Quiz questions test **understanding**, not fact recall (avoid "what is X" — prefer "why does X happen" / "which scenario best illustrates X")
- [ ] 所有选择题（md 内联 + quiz.json）满足下方「选择题质量硬约束」
- [ ] quiz.json 是合法 JSON（无未转义双引号；用 Read 复核一遍）
- [ ] 内联 `[!quiz]` 选项行无 ✓/✅ 标记（答案只在折叠 `[!answer]` 里）
- [ ] quiz.json 题目与内联 `[!quiz]` 题目无重叠

**类型条件项（按判定的 course_type 只检查对应一行）:**
- [ ] **technical**: ≥ 1 个代码示例且带语言标签；≥ 1 个 mermaid 图且图型匹配内容形态
- [ ] **engineering**: ≥ 1 处**真公式**（化学/热力学/工艺）；≥ 1 处**真实工业实例**（设备/槽型/工艺参数/产地产能）；**零编程代码块、零伪代码**（除 mermaid/text/tex 外的 ` ```lang ` 一律不应出现）；工艺/结构 mermaid 图型匹配内容形态（工艺流→flowchart LR、结构→flowchart TB）
- [ ] **humanities**: ≥ 1 处具体作品实例（具体到乐章/时间点/年代/出处）；**无凑数伪代码**（不虚构与内容无关的代码块）；出现的 mermaid 图型匹配内容形态（演变→timeline、体系→mindmap/flowchart TB）
- [ ] **hybrid**: 计算类小节含代码/公式，赏析类小节含具体作品实例，无混乱混搭

## 选择题质量硬约束（MANDATORY — 适用于 md 内联 quiz 与 quiz.json）

1. **位置随机**：正确项在 A-D 中随机分布，一批题目里 4 个位置都要出现，禁止固定位。
2. **长度均衡**：最长选项与最短选项的字数比 ≤ 1.8；正确项不得明显比干扰项更长更详细。
3. **正确项不照抄**：用自己的话改写，不得整句粘贴正文原文。
4. **干扰项是合理陷阱**：基于常见误解/易混概念，让没掌握的人真会选；禁止一眼荒谬或跨领域胡扯。
5. **盲选自检**：写完后捂住答案只看选项——若凭长度/位置/措辞能猜对，或能瞬间排除两项以上，必须重写该题。
6. **选项不带答案标记**：内联 `[!quiz]` 的选项行禁止出现 ✓/✅ 或任何正确性暗示；答案只写在折叠的 `[!answer]` 块里。
7. **两套题不重叠**：内联 `[!quiz]`（阅读时即时自测，考本节直接理解）与 quiz.json（随堂考察，考应用/迁移/对比）必须是**不同的题目**，禁止同一题两处复用。

**Formatting:**
- [ ] Any math that appears uses `$...$` or `$$...$$` (not raw `\(...\)`)
- [ ] Any code block has a language tag (e.g. ` ```python `, not just ` ``` `)
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
- **[examples.md](references/examples.md)** — worked examples (technical + humanities fragments) of a complete chapter + quiz.json + concepts.json. Read if you want a concrete template to mirror.
- **[callout-format-spec.md](references/callout-format-spec.md)** — **EXACT** format for `[!question]`, `[!quiz]`, `[!answer]` callouts, including nesting, collapsible markers, and option formatting. Read this before writing the learning elements.

## Style continuity

After onboarding or after writing chapter 1, re-read the most recent `*.md` file in the project. Match its:
- Heading style (e.g., `## ` vs `# ` for sections)
- Mermaid conventions (diagram types actually used)
- Voice (casual vs formal)
- Length per section
- **课程类型处理**——全课程一致，不得一章技术化、一章人文化

Inconsistent style between chapters is jarring. Consistency matters more than variety.

## Failure modes

- **API rate limit / timeout**: stop, return what you wrote so far, let host decide to retry
- **Write tool denied**: usually means session has wrong permissions — abort and ask host to re-init session
- **Format spec changes mid-session**: read the spec again, don't cache
