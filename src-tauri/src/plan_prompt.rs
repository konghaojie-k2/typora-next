//! Course-planning prompt + response parsing (pure functions, no tauri deps).
//!
//! Extracted from ai_agent.rs so the logic is unit-testable via `#[path]`
//! include (app_lib-linked test exes fail to start on some machines with
//! STATUS_ENTRYPOINT_NOT_FOUND).
//!
//! Run tests with: cargo test --test plan_prompt_test

use serde_json::Value;

/// Build the LLM prompt for course planning (goal/level/hours → outline JSON).
/// Pure function — extracted for testability.
/// Mirrors the prompt that previously lived in agent-bridge.mjs planCourse().
///
/// `learner_context` (Sprint 21): aggregated cross-course memory block from
/// `learner_profile::aggregate_learner_context`. `None` (or empty) produces a
/// prompt byte-identical to the pre-Sprint-21 form — users with no completed
/// courses see zero behavior change.
pub fn build_plan_prompt(
    goal: &str,
    level: &str,
    hours: u32,
    learner_context: Option<&str>,
) -> String {
    let level_names = [
        ("beginner", "小白（零基础）"),
        ("intermediate", "有编程基础"),
        ("advanced", "专业进阶"),
    ];
    let level_label = level_names
        .iter()
        .find(|(k, _)| *k == level)
        .map(|(_, v)| *v)
        .unwrap_or(level);

    let learner_section = learner_context
        .filter(|s| !s.trim().is_empty())
        .map(|ctx| {
            format!(
                r#"## 学习者历史（来自已完结课程，仅供参考）
{ctx}

## 衔接规则
1. 「已掌握」概念如与本课目标相关，不得作为独立章节，可在相关章节一句带过
2. 「薄弱」概念如与本课目标相关，在大纲前部安排一章衔接复习（标题体现承上，如「回顾：……」）
3. 与本课目标无关的历史全部忽略

"#
            )
        })
        .unwrap_or_default();

    format!(
        r#"你是一个资深的学习设计师。请根据以下信息设计一个结构化的学习大纲。

学习目标：{goal}
难度级别：{level_label}
预计投入时间：{hours} 小时

{learner_section}要求：
1. 大纲要深入浅出、逻辑连贯
2. 从基础到进阶，循序渐进
3. 每章包含：标题、预计时长（分钟）、涉及的核心概念
4. 总时长控制在用户指定范围内（允许 ±20% 偏差）
5. 章节数量：1小时≈2-3章，3小时≈6-8章，8小时≈12-16章
6. 判断课程类型 course_type：编程/框架/算法/软件工程类 → "technical"；音乐/艺术/历史/文学/哲学等人文类 → "humanities"；理工学院/工艺/化工/材料/机械等真实工业与过程工程类 → "engineering"；两者混合 → "hybrid"

输出格式（必须是纯 JSON）：
```json
{{
  "project_slug": "diffusion-model",
  "course_type": "technical",
  "chapters": [
    {{
      "title": "章节标题",
      "duration_minutes": 25,
      "concepts": ["概念1", "概念2"]
    }}
  ],
  "total_duration": 170
}}
```

注意：
- project_slug 是用英文小写字母和短横线组成的目录名（kebab-case），用于作为文件系统目录名，比如 "diffusion-model" / "attention-mechanism" / "react-basics"。最多 50 字符。
- course_type 决定章节生成时的模板分支（技术课用代码/公式/流程图；人文课用具体作品实例/时间线/表格；**engineering 用真实公式/工艺流程图/真实工业实例且禁编程代码块**），必须按学习目标的内容性质如实判断，不要默认填 technical。"#,
        goal = goal,
        level_label = level_label,
        hours = hours,
        learner_section = learner_section,
    )
}

/// Parse the LLM's plan response into a normalized outline JSON.
/// Pure function — extracted for testability.
/// Strips markdown code block wrappers if present, then parses JSON.
/// Mirrors `extractJSON` from agent-bridge.mjs plus normalization that
/// previously lived there.
///
/// Only `chapters` / `total_duration` / `project_slug` are rewritten; unknown
/// top-level fields (e.g. `course_type`) pass through untouched.
pub fn parse_plan_response(raw: &str) -> Result<Value, String> {
    // Strip markdown code block wrappers
    let cleaned = raw.trim();
    let cleaned = if cleaned.starts_with("```") {
        cleaned
            .lines()
            .skip(1) // skip ```json or ```
            .take_while(|l| !l.trim_start().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        cleaned.to_string()
    };

    // Parse JSON
    let mut outline: Value = serde_json::from_str(&cleaned).map_err(|e| {
        format!(
            "解析大纲 JSON 失败: {} — 原始响应: {}",
            e,
            &raw[..raw.len().min(200)]
        )
    })?;

    // Validate chapters
    let chapters = outline
        .get("chapters")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "大纲格式错误：缺少 chapters 数组".to_string())?;

    // Normalize chapters (fill in defaults for missing fields)
    let normalized: Vec<Value> = chapters
        .iter()
        .enumerate()
        .map(|(i, ch)| {
            let title = ch
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("第 {} 章", i + 1));
            let duration_minutes = ch
                .get("duration_minutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(20) as u32;
            let concepts: Vec<String> = ch
                .get("concepts")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            serde_json::json!({
                "title": title,
                "duration_minutes": duration_minutes,
                "concepts": concepts,
            })
        })
        .collect();

    let total_duration: u32 = normalized
        .iter()
        .map(|ch| {
            ch.get("duration_minutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32
        })
        .sum();

    outline["chapters"] = Value::Array(normalized);
    outline["total_duration"] = Value::Number(total_duration.into());

    // Sanitize project_slug (English kebab-case). Fallback to a safe default.
    let slug_is_valid = outline
        .get("project_slug")
        .and_then(|v| v.as_str())
        .map(|s| {
            !s.is_empty()
                && s.len() <= 50
                && s.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                && s.chars()
                    .next()
                    .map(|c| c.is_ascii_alphanumeric())
                    .unwrap_or(false)
        })
        .unwrap_or(false);
    if !slug_is_valid {
        outline["project_slug"] = Value::String("learning-project".to_string());
    }

    Ok(outline)
}
