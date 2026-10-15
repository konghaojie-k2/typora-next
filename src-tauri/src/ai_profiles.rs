//! AI 模型配置 profile（断流容灾 2026-10-14 设计文档第 2 段）。
//!
//! 一张 profile 卡 = 连接 + 模型的完整组合；同一 provider 的多个模型 = 多张卡。
//! 无主备语义：谁激活谁在用。旧四字段（api_key/ai_provider/ai_base_url/model）
//! 保留为「激活 profile 的派生视图」，下游全部调用方零改动。
//!
//! 纯逻辑模块，不依赖 tauri，供 lib.rs 调用、tests/ 经 #[path] include 直测。

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    /// "anthropic" / "openai"（与 AiProvider 的 lowercase serde 表示一致；
    /// 这里用 String 保持本模块独立于 lib.rs，可 #[path] include 直测）
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

fn non_empty(s: &Option<String>) -> bool {
    s.as_deref().map(|v| !v.trim().is_empty()).unwrap_or(false)
}

/// 旧四字段 → 单 profile + 激活。仅当旧配置有实质内容（key 或 model 非空）
/// 时迁移；全新安装返回 None（不造空卡）。
pub fn migrate_legacy(
    api_key: &Option<String>,
    provider: &Option<String>,
    base_url: &Option<String>,
    model: &Option<String>,
) -> Option<(Vec<AiProfile>, String)> {
    if !non_empty(api_key) && !non_empty(model) {
        return None;
    }
    let name = model.clone().unwrap_or_else(|| "默认配置".to_string());
    let profile = AiProfile {
        id: "profile-1".to_string(),
        name,
        provider: provider.clone(),
        base_url: base_url.clone(),
        api_key: api_key.clone(),
        model: model.clone(),
    };
    let id = profile.id.clone();
    Some((vec![profile], id))
}

/// 从激活 profile 派生旧字段视图：(api_key, provider, base_url, model)。
/// 激活 id 悬空（指向已删除的卡）时回退第一张；空列表返回 None（不动旧字段）。
pub fn derive_legacy(
    profiles: &[AiProfile],
    active_id: &Option<String>,
) -> Option<(Option<String>, Option<String>, Option<String>, Option<String>)> {
    if profiles.is_empty() {
        return None;
    }
    let active = active_id
        .as_deref()
        .and_then(|id| profiles.iter().find(|p| p.id == id))
        .unwrap_or(&profiles[0]);
    Some((
        active.api_key.clone(),
        active.provider.clone(),
        active.base_url.clone(),
        active.model.clone(),
    ))
}
