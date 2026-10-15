//! Integration tests for the shared OpenAI-compatible request body builder.
//!
//! Pure logic lives in src/llm_body.rs — included via `#[path]` because
//! app_lib-linked test exes fail to start on some machines
//! (STATUS_ENTRYPOINT_NOT_FOUND).
//!
//! Run with: cargo test --test llm_body_test

#[path = "../src/llm_body.rs"]
mod llm_body;

use llm_body::openai_chat_body;
use llm_body::versioned_url;

// ============================================
// versioned_url：base_url 版本段归一化（2026-10-15 MiniMax /v1/v1 404 事故）
// 与 agent-bridge.mjs pingProvider / _writeTempModelsJson 同语义：
// base 已带 /v\d+ 版本段 → 直接拼 path；否则补 /v1。
// ============================================

#[test]
fn base_with_v1_suffix_not_duplicated() {
    // 事故现场：MiniMax 官方 base_url 自带 /v1，旧代码再拼一次 → /v1/v1 → 404
    assert_eq!(
        versioned_url("https://api.minimaxi.com/v1", "chat/completions"),
        "https://api.minimaxi.com/v1/chat/completions"
    );
}

#[test]
fn base_without_version_segment_gets_v1() {
    assert_eq!(
        versioned_url("https://api.deepseek.com", "chat/completions"),
        "https://api.deepseek.com/v1/chat/completions"
    );
    assert_eq!(
        versioned_url("https://api.anthropic.com", "messages"),
        "https://api.anthropic.com/v1/messages"
    );
}

#[test]
fn trailing_slashes_trimmed() {
    assert_eq!(
        versioned_url("https://api.minimaxi.com/v1/", "chat/completions"),
        "https://api.minimaxi.com/v1/chat/completions"
    );
    assert_eq!(
        versioned_url("https://api.deepseek.com/", "chat/completions"),
        "https://api.deepseek.com/v1/chat/completions"
    );
}

#[test]
fn other_version_segments_preserved() {
    // /v2 等版本段同样视为已带版本，不被改写为 /v1
    assert_eq!(
        versioned_url("https://proxy.example.com/v2", "messages"),
        "https://proxy.example.com/v2/messages"
    );
}

#[test]
fn version_segment_must_be_at_tail() {
    // /v1 出现在中间（非尾部）不算已带版本段，照常补 /v1
    assert_eq!(
        versioned_url("https://proxy.example.com/v1/beta", "messages"),
        "https://proxy.example.com/v1/beta/v1/messages"
    );
}


#[test]
fn deepseek_endpoint_disables_thinking() {
    let body = openai_chat_body("deepseek-v4-flash", 4096, "hi", "https://api.deepseek.com");
    assert_eq!(
        body["thinking"]["type"], "disabled",
        "DeepSeek 端点必须关闭思考"
    );
    assert_eq!(body["model"], "deepseek-v4-flash");
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["messages"][0]["content"], "hi");
}

#[test]
fn deepseek_endpoint_with_path_suffix_also_disables() {
    // 用户可能配置带路径的 base_url（如 https://api.deepseek.com/v1 之外的代理形态）
    let body = openai_chat_body("m", 100, "hi", "https://api.deepseek.com/beta");
    assert_eq!(body["thinking"]["type"], "disabled");
}

#[test]
fn openai_official_not_injected() {
    let body = openai_chat_body("gpt-4o-mini", 100, "hi", "https://api.openai.com");
    assert!(
        body.get("thinking").is_none(),
        "非 DeepSeek 端点不得注入 thinking 字段（会因未知字段 400）"
    );
}

#[test]
fn third_party_proxy_not_injected() {
    // 代理服务（如 aliyun proxy）转发到非 DeepSeek 模型时不应注入
    let body = openai_chat_body("qwen-max", 100, "hi", "https://proxy.example.com/v1");
    assert!(body.get("thinking").is_none());
}
