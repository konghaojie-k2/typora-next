//! Agent event project scoping.
//!
//! `agent-event` 是全局频道，前端每个存活 AgentEventBridge 都会收到所有
//! 课程的事件。chapter_complete 的持久化以 bridge 自己的 ui.projectPath
//! 为目标——后台 A 课程生成完成时，前台 B 课程的 bridge 会把 A 的文件名
//! 写进 B 的 project.json（2026-10-29 实爆：三个课程的头 2 章 file 字段
//! 互相污染，重进后按错误 file 查 chapters_status → 显示「被重置」）。
//!
//! 修复：在 run_agent_bridge 的唯一转发点给事件打上 data.projectPath，
//! 前端 bridge 据此忽略不属于本项目的事件。

use serde_json::Value;

/// Tag a forwarded agent event with the owning project path.
///
/// - `data.projectPath` 已存在（bridge 自带）→ 以 bridge 的为准，不覆盖
/// - `data` 缺失 → 创建对象再写入
/// - `data` 非对象 / project_path 为空 → 不动（宁缺勿错，前端按无身份旧事件放行）
pub fn tag_event_with_project(project_path: &str, event: &mut Value) {
    if project_path.is_empty() {
        return;
    }
    if event.get("data").map(|d| !d.is_object()).unwrap_or(false) {
        return;
    }
    if event.get("data").is_none() {
        event["data"] = serde_json::json!({});
    }
    if let Some(data) = event.get_mut("data").and_then(|d| d.as_object_mut()) {
        data.entry("projectPath".to_string())
            .or_insert_with(|| Value::String(project_path.to_string()));
    }
}
