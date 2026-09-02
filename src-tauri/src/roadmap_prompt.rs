//! 课程完结 roadmap 的 prompt 构建与响应解析（Sprint 22）。
//!
//! 纯逻辑模块（无 Tauri 依赖），经 `#[path]` include 方式被
//! tests/roadmap_prompt_test.rs 直接测试（规避 app_lib 链接问题）。
//!
//! 调用方：ai_agent.rs 的 generate_roadmap 命令（ureq 单次调用，
//! 非 agent loop——无文件读取、无多步推理、无对话需求）。

use serde_json::{json, Value};

/// 换意向 → prompt 指令。未知意向静默忽略。
fn intent_instruction(intent: &str) -> Option<&'static str> {
    match intent {
        "harder" => Some("用户希望【加大难度】：推荐更深的方向，级别可上调，避免入门向内容。"),
        "gentler" => Some(
            "用户希望【平缓过渡】：把大目标拆小，推荐与已掌握内容紧密衔接的方向，建议时长适当拉长。",
        ),
        "different" => {
            Some("用户希望【换个领域】：推荐与本课程不同领域（或相邻领域）的方向，避免同主题延伸。")
        }
        _ => None,
    }
}

/// 构建 roadmap 生成 prompt。
///
/// - `course_name`：刚完结的课程名
/// - `profile`：`.learning/completion-profile.json` 内容（可为 None / 损坏时调用方传 None）
/// - `learner_context`：Sprint 21 全局索引聚合出的其他课程历史（可为 None）
/// - `intent`：换一批意向（harder/gentler/different），None 表示首次生成
/// - `exclude_goals`：此前已推荐过、用户不要的方向（换一批时累积）
pub fn build_roadmap_prompt(
    course_name: &str,
    profile: Option<&Value>,
    learner_context: Option<&str>,
    intent: Option<&str>,
    exclude_goals: &[String],
) -> String {
    // 本课掌握情况
    let mut mastery = String::new();
    if let Some(p) = profile {
        if let Some(concepts) = p.get("concepts").and_then(|c| c.as_array()) {
            let mastered: Vec<&str> = concepts
                .iter()
                .filter(|c| c.get("status").and_then(|s| s.as_str()) == Some("mastered"))
                .filter_map(|c| c.get("name").and_then(|n| n.as_str()))
                .collect();
            let struggling: Vec<&str> = concepts
                .iter()
                .filter(|c| c.get("status").and_then(|s| s.as_str()) == Some("struggling"))
                .filter_map(|c| c.get("name").and_then(|n| n.as_str()))
                .collect();
            if !mastered.is_empty() {
                mastery.push_str(&format!("已掌握概念：{}\n", mastered.join("、")));
            }
            if !struggling.is_empty() {
                mastery.push_str(&format!("学得吃力的概念：{}\n", struggling.join("、")));
            }
        }
        if let Some(course_type) = p.get("course_type").and_then(|t| t.as_str()) {
            mastery.push_str(&format!("课程类型：{course_type}\n"));
        }
    }
    if mastery.is_empty() {
        mastery.push_str("（无详细掌握数据）\n");
    }

    // 学习者历史（其他已完结课程）
    let history_section = match learner_context {
        Some(ctx) if !ctx.trim().is_empty() => {
            format!("## 学习者历史（其他已完结课程）\n{ctx}\n\n")
        }
        _ => String::new(),
    };

    // 排除约束
    let exclude_section = if exclude_goals.is_empty() {
        String::new()
    } else {
        format!(
            "## 已排除方向\n以下方向已推荐过且用户不满意，本次推荐【不得】与其重复或高度相似：\n{}\n\n",
            exclude_goals
                .iter()
                .map(|g| format!("- {g}"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };

    // 意向指令
    let intent_section = intent
        .and_then(intent_instruction)
        .map(|i| format!("## 用户意向\n{i}\n\n"))
        .unwrap_or_default();

    format!(
        r#"你是一位学习路径规划师。用户刚学完一门课程，需要你推荐下一阶段的学习方向。

## 刚完结的课程
课程名：{course_name}
{mastery}
{history_section}{exclude_section}{intent_section}## 任务
推荐 2~3 个下一阶段学习方向。要求：
1. 每个方向必须给出 reason，且 reason 必须【点名具体依据】——引用上面列出的已掌握/吃力概念或历史课程，禁止空话（如"对你有帮助"）。
2. 方向之间应有区分度（深度延伸 / 横向拓展 / 补弱衔接等）。
3. level 只能是 beginner / intermediate / advanced；hours 为建议投入小时数（整数）。
4. 只输出 JSON，不要输出任何其他文字。

输出格式：
```json
{{"directions": [{{"goal": "方向标题", "reason": "具体依据", "level": "intermediate", "hours": 5}}]}}
```
"#,
        course_name = course_name,
        mastery = mastery,
        history_section = history_section,
        exclude_section = exclude_section,
        intent_section = intent_section,
    )
}

/// 解析 LLM 返回的 roadmap JSON。
///
/// 归一化规则：
/// - 剥离 ``` 代码块包裹；
/// - 顶层必须有 directions 数组；
/// - 每项：goal 非空字符串（必需），reason 缺省 ""，level 非法值归一为
///   intermediate，hours 非法值归一为 3；
/// - 过滤 goal 命中 exclude_goals 的项（换一批去重）；
/// - 最多保留 3 项；
/// - 全部过滤完或无有效项 → Err。
pub fn parse_roadmap_response(raw: &str, exclude_goals: &[String]) -> Result<Vec<Value>, String> {
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: Value =
        serde_json::from_str(cleaned).map_err(|e| format!("roadmap JSON 解析失败: {e}"))?;

    let directions = parsed
        .get("directions")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "roadmap JSON 缺少 directions 数组".to_string())?;

    let valid_levels = ["beginner", "intermediate", "advanced"];
    let mut out: Vec<Value> = Vec::new();

    for item in directions {
        let goal = match item.get("goal").and_then(|g| g.as_str()) {
            Some(g) if !g.trim().is_empty() => g.trim().to_string(),
            _ => continue,
        };
        if exclude_goals.iter().any(|e| e == &goal) {
            continue;
        }
        let reason = item
            .get("reason")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string();
        let level = match item.get("level").and_then(|l| l.as_str()) {
            Some(l) if valid_levels.contains(&l) => l.to_string(),
            _ => "intermediate".to_string(),
        };
        let hours = item
            .get("hours")
            .and_then(|h| h.as_u64())
            .filter(|&h| h > 0)
            .unwrap_or(3);

        out.push(json!({
            "goal": goal,
            "reason": reason,
            "level": level,
            "hours": hours,
        }));
        if out.len() >= 3 {
            break;
        }
    }

    if out.is_empty() {
        Err("roadmap 无有效方向".to_string())
    } else {
        Ok(out)
    }
}
