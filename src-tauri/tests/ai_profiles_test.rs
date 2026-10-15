//! Integration tests for AI profile 配置（断流容灾 2026-10-14 设计文档第 2 段）。
//!
//! 纯逻辑在 src/ai_profiles.rs —— 用 `#[path]` include，
//! 因为 app_lib 链接的测试 exe 在部分机器起不来（见 decisions.md）。
//!
//! Run with: cargo test --test ai_profiles_test

#[path = "../src/ai_profiles.rs"]
mod ai_profiles;

use ai_profiles::{derive_legacy, migrate_legacy, AiProfile};

fn card(id: &str, name: &str, model: &str) -> AiProfile {
    AiProfile {
        id: id.to_string(),
        name: name.to_string(),
        provider: Some("openai".to_string()),
        base_url: Some("https://api.example.com".to_string()),
        api_key: Some(format!("key-{id}")),
        model: Some(model.to_string()),
    }
}

#[test]
fn migrate_legacy_with_full_old_config() {
    let r = migrate_legacy(
        &Some("sk-x".to_string()),
        &Some("openai".to_string()),
        &Some("https://api.deepseek.com".to_string()),
        &Some("deepseek-flash".to_string()),
    );
    let (profiles, active) = r.expect("旧四字段有内容应迁移");
    assert_eq!(profiles.len(), 1);
    assert_eq!(active, profiles[0].id, "迁移后立即激活");
    assert_eq!(profiles[0].api_key.as_deref(), Some("sk-x"));
    assert_eq!(profiles[0].model.as_deref(), Some("deepseek-flash"));
    assert_eq!(profiles[0].provider.as_deref(), Some("openai"));
}

#[test]
fn migrate_legacy_skips_empty_config() {
    // 全新安装（旧字段全空）不造空卡
    assert!(migrate_legacy(&None, &None, &None, &None).is_none());
    assert!(migrate_legacy(&Some(String::new()), &None, &None, &Some(String::new())).is_none());
}

#[test]
fn derive_legacy_follows_active_profile() {
    let profiles = vec![card("a", "DeepSeek", "deepseek-flash"), card("b", "备用", "gpt-x")];
    let (key, provider, base_url, model) =
        derive_legacy(&profiles, &Some("b".to_string())).expect("有激活项应派生");
    assert_eq!(key.as_deref(), Some("key-b"));
    assert_eq!(model.as_deref(), Some("gpt-x"));
    assert_eq!(provider.as_deref(), Some("openai"));
    assert_eq!(base_url.as_deref(), Some("https://api.example.com"));

    // 激活 id 失效（指向已删除的卡）→ 回退第一张，不留悬空
    let (key, ..) = derive_legacy(&profiles, &Some("gone".to_string())).expect("失效激活回退");
    assert_eq!(key.as_deref(), Some("key-a"));

    // 空列表 → 无派生（不动旧字段）
    assert!(derive_legacy(&[], &None).is_none());
}
