---
name: typora-paper-reader
description: Generate a structured reading guide for an academic paper markdown file. Use when the host invokes "请用 typora-paper-reader skill 为以下论文生成导读" with a paper file path and user persona. Reads the paper, identifies key points based on the persona, writes a JSON guide to disk.
---

# Typora Paper Reader Skill

Generate a structured reading guide for an academic paper. The guide should help the user reach **L1 understanding**: after reading, they can summarize the core problem, method, and key conclusion in their own words.

## User Persona

Generate the guide for the following target user. If the host provides a different persona in the input, prefer the host's input; otherwise use this default.

**Default target user:**

- Knows neural network basics (input/output, training, loss functions)
- Wants to understand generative models / AI principles
- Prefers plain-language explanations, dislikes information overload
- Cannot read papers word-by-word; needs AI to pre-identify key points
- Current goal: **L1 understanding** — can summarize the core problem, method, and key conclusion in their own words after reading

**Implications for generation:**

- Use everyday Chinese explanations first; introduce formulas only as intuition aids.
- Highlight 1-3 key points per section, not every detail.
- Avoid assuming knowledge of variational inference, Bayesian methods, or advanced probability.
- Focus on "what is this" and "why does it matter" rather than formal derivations.

## Input

The host's prompt will contain:

```json
{
  "paper_file": "C:\\Users\\17625\\Documents\\VAE_论文\\md\\1312.6114.md",
  "output_file": "C:\\Users\\17625\\Documents\\VAE_论文\\.learning\\paper-reader-guide.json",
  "persona": {
    "level": "beginner",
    "background": ["neural_network_basics"],
    "goal": "understand_generative_models",
    "preference": "plain_language"
  }
}
```

## Workflow

1. **Read the paper**: Use the `Read` tool to read the full markdown file at `paper_file`.
2. **Understand structure**: Identify sections by Markdown headings (e.g. `## Abstract`, `## 1 Introduction`, `## 2 Method`).
3. **Generate guide**: Based on the user persona, identify key points, write human explanations, and create check questions.
4. **Write output**: Use the `Write` tool to write the JSON guide to `output_file`.

The host will typically cache this output at `.learning/paper-reader-guides/{paper_identifier}.json` and reuse it on subsequent opens.

## Output Format

Write a single JSON object to `output_file`:

```json
{
  "title": "Auto-Encoding Variational Bayes",
  "authors": "Diederik P. Kingma, Max Welling",
  "source_file": "C:\\Users\\17625\\Documents\\VAE_论文\\md\\1312.6114.md",
  "generated_at": "2026-07-02T12:00:00",
  "persona_level": "beginner",
  "reading_order": [
    {
      "step": 1,
      "section_id": "sec_abstract",
      "title": "Abstract",
      "goal": "抓住 intractable posterior 和 large datasets 两个关键词",
      "skip": false
    }
  ],
  "sections": [
    {
      "id": "sec_abstract",
      "title": "Abstract",
      "level": 2,
      "order": 1,
      "goal": "抓住 intractable posterior 和 large datasets 两个关键词",
      "skip": false,
      "key_points": [
        {
          "id": "kp_1",
          "highlight_text": "intractable posterior distributions",
          "term_level": "must_know",
          "human_explanation": "真实后验 p(z|x) 算不出来。因为分母 p(x)=∫p(z)p(x|z)dz 通常没有闭式解，所以后验也写不出来。",
          "analogy": "记住这七个字：'算不出来的后验'。"
        }
      ],
      "check_questions": [
        "为什么论文里说后验分布是 intractable 的？"
      ]
    }
  ],
  "summary_check_questions": [
    "VAE 解决的核心问题是什么？",
    "ELBO 是什么？它为什么重要？",
    "重参数化 trick 是干嘛的？"
  ]
}
```

### Field definitions

- **`title`**: Paper title.
- **`authors`**: Authors if identifiable, otherwise empty string.
- **`source_file`**: The original paper file path.
- **`generated_at`**: ISO 8601 timestamp.
- **`persona_level`**: Echo of input persona level.
- **`reading_order`**: Ordered list of sections to read. Each entry has:
  - `step`: 1-based reading order
  - `section_id`: References `sections[].id`
  - `title`: Section title
  - `goal`: What the user should get from this section
  - `skip`: `true` if the section can be skipped on first read
- **`sections`**: Array of section guides. Each has:
  - `id`: Unique section identifier
  - `title`: Section title from the paper
  - `level`: Markdown heading level (e.g. 2 for `##`)
  - `order`: 1-based position in the paper
  - `goal`: One-sentence reading goal
  - `skip`: Whether to skip on first read
  - `key_points`: Array of highlighted concepts
  - `check_questions`: 0-3 plain-language review questions for this section
- **`summary_check_questions`**: 2-4 questions that test overall L1 understanding of the whole paper. Place concepts here that cannot be understood until the entire paper has been read.

### Key point object

- **`id`**: Unique key point id within the section, e.g. `kp_1`.
- **`highlight_text`**: An exact substring from the paper's rendered text. The frontend will highlight this text. Keep it short (5-15 words) and unique enough to be found in the section.
  - **Important**: Choose text that survives Markdown-to-HTML rendering. Avoid raw math markup like `$...$` or LaTeX commands. Prefer plain words or short phrases.
- **`term_level`**: One of:
  - `"must_know"` — core concept the user must understand (frontend shows red tag)
  - `"good_to_know"` — helpful but not blocking (frontend shows green tag)
  - `"skip_first_read"` — too detailed for first pass (frontend shows gray tag)
- **`human_explanation`**: 1-3 sentences in plain Chinese. Explain what it is and why it matters.
- **`analogy`**: Optional short analogy or memory aid.

## Rules

### 1. Read the full paper first

Do not generate key points from memory or general knowledge. Use the `Read` tool on `paper_file` before writing output.

### 2. Identify key points from the user's perspective

A "key point" is something that:
- The user is likely to not understand on first read
- Is essential for L1 understanding of the paper
- Represents a core concept, method innovation, key trick/intuition, or experimental conclusion

Do NOT mark:
- Generic background facts the persona already knows
- Detailed proofs or derivations
- Related work comparisons
- Implementation hyperparameters (unless central to the method)

### 3. Density control

- **Abstract**: 2-3 key points
- **Introduction**: 2-3 key points
- **Each method subsection**: 1-3 key points
- **Example section**: 2-4 key points
- **Experiments**: 1-3 key points
- **Conclusion**: 1-2 key points

Total key points for a typical paper: 10-20. When in doubt, prefer fewer, deeper explanations over more shallow ones.

### 4. Human explanation style

- First sentence: say **what it is**.
- Second sentence: say **why it matters** or **what problem it solves**.
- Use concrete examples when possible.
- Avoid long formulas. If a formula is unavoidable, explain the symbols in words first.
- Use analogies only when they genuinely help; don't force them.

Example of good explanation:

> **ELBO** is a substitute objective that we can actually compute. It is always less than or equal to the true log-likelihood we really want. Maximizing ELBO squeezes the approximate posterior closer to the true posterior.

Example of bad explanation:

> ELBO is the Evidence Lower Bound, defined as 𝔼[log pθ(x|z)] − DKL(qφ(z|x) || pθ(z)).

### 5. highlight_text must be findable in rendered HTML

The `highlight_text` must appear verbatim in the section text **after Markdown-to-HTML rendering**. If the original uses math markup or special characters, choose a plain-text fragment that is clearly present in the rendered output.

For example, prefer:

> `"intractable posterior distributions"`

Avoid:

> `"$p_\\theta(z|x)$"` — math markup may not render as literal text.

### 6. Reading order

Default order follows the paper structure, but:

- Move Abstract to step 1
- Mark Related Work sections as `skip: true`
- Mark appendix sections as `skip: true`
- Keep Method subsections in their original order

### 7. Check question placement

- Place check questions in `sections[].check_questions` when they test **section-independent understanding**.
- Place check questions in `summary_check_questions` when they require understanding the **whole paper** (e.g. "What is the relationship between SGVB, AEVB, and VAE?").
- Each section should have 0-3 questions; `summary_check_questions` should have 2-4 questions.
- All questions should:
  - Test L1 understanding, not memorization
  - Use plain language
  - Be answerable without re-deriving formulas

Good section question:

> Why is the posterior distribution p(z|x) called "intractable"?

Good summary question:

> What is the relationship between SGVB, AEVB, and VAE?

Bad question:

> Write down the full ELBO equation.

### 8. Language

- `human_explanation`, `analogy`, `goal`, and all `check_questions` should be in **Chinese**.
- `title`, `authors`, `highlight_text` should preserve the paper's original language (usually English).

### 9. No hallucination

If you are uncertain about a paper's claim, mark the term level as `"skip_first_read"` rather than inventing an explanation.

### 10. Output validity

Ensure the JSON is valid. Do not include trailing commas or unescaped quotes.
