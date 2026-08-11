//! 课程完结状态（Sprint 16）
//!
//! 章节级状态机到 completed 为止，没有课程级终态——导致学完后每次进入
//! 项目仍被「今日复习 N」催促。本模块提供写侧规则：全部章节完成时在
//! project.json 顶层落 `course_status = "completed"`（课程级终态）。
//!
//! 读侧派生（含存量项目兼容）在前端 course-summary.js 的
//! isProjectCourseCompleted。

use serde_json::Value;

/// 全部章节完成时在 project.json 顶层落 `course_status = "completed"`。
///
/// 判定规则（与前端 isProjectCourseCompleted 保持一致）：
/// - chapters 非空；
/// - 每章状态取 chapters_status[file]，回退 v1 的 chapter.status；
/// - 状态值为 "completed" 或中文存量值 "已完成"。
///
/// 返回 true 表示课程已完结（幂等：已落字段时仍为 true）。
pub fn mark_course_completed_if_done(project: &mut Value) -> bool {
    let chapters = match project.get("chapters").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr,
        _ => return false,
    };
    let status_map = project.get("chapters_status").and_then(|v| v.as_object());

    let all_completed = chapters.iter().all(|ch| {
        let file = ch.get("file").and_then(|v| v.as_str()).unwrap_or("");
        let status = status_map
            .and_then(|m| m.get(file))
            .and_then(|v| v.as_str())
            .or_else(|| ch.get("status").and_then(|v| v.as_str()))
            .unwrap_or("");
        status == "completed" || status == "已完成"
    });

    if !all_completed {
        return false;
    }
    project["course_status"] = Value::String("completed".to_string());
    true
}
