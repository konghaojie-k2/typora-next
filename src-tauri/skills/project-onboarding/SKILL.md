---
name: project-onboarding
description: Read-only orientation for a new agent session in a learning project. Use when the host prompts "请使用 project-onboarding skill 了解这个项目". Read project state, summarize in markdown, do NOT modify any files. Run once per session (typically at init).
---

# Project Onboarding

Orient yourself in a learning project workspace. Read-only. Do not modify files.

## When invoked

Host prompt will include the project path. If `$ARGUMENTS.project_path` is given, use it; otherwise the agent SDK's `cwd` is the project root.

## Steps

Use **Read** and **Glob** tools only. No Write, no Edit, no Bash.

1. **Read** `{project_path}/.learning/project.json`. Expect fields: `name`, `created`, `chapters[]`, `total_duration`. If missing, the project hasn't been initialized — tell the user and stop.
2. **Glob** `{project_path}/*.md` to find chapter files (zero-padded, e.g. `00-*.md`, `01-*.md`). Sort by name to get generation order.
3. **Read** the most recent chapter file (last in sorted order). This is the current progress anchor and shows the writing style to maintain.
4. **Read** the most recent `*.concepts.json` to extract top concepts. If none, the project is fresh.

## Output

Return a single markdown text response (the host displays it as the agent's first message):

```markdown
## 项目摘要

**主题**: {project.name}
**进度**: 已完成 {N}/{M} 章 ({percent}%)
**当前焦点**: {latest chapter title or "尚未开始"}
**已学概念**: {top 3-5 from concepts.json, comma-separated; "无" if fresh}

**接下来**: {one-line suggestion: 完成第 N+1 章 / 复习 / 等等}
```

Keep it under 200 words. No code blocks, no Mermaid.

## Failure modes

- `project.json` missing → respond `项目尚未初始化` and exit
- No `*.md` files yet → say `已规划 {M} 章但尚未生成任何内容`
- Permission errors reading files → list which files failed; don't silently skip
