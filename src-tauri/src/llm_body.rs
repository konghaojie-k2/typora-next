//! 构建 OpenAI 兼容 chat completions 请求体的纯函数模块。
//!
//! 独立成模块是为了 `#[path]` 集成测试（app_lib 链接的测试 exe 在本机
//! 起不来，见 plan_prompt_test.rs 注释）。

/// 拼接带版本段的 API URL：base 已带 `/v\d+` 尾部版本段则直接使用，
/// 否则补 `/v1`。与 agent-bridge.mjs 的 pingProvider / _writeTempModelsJson
/// 归一化语义一致（2026-10-15 MiniMax 事故：官方 base_url 自带 /v1，
/// 旧代码无脑再拼 /v1 → /v1/v1 → 404，而 bridge 路径有归一化 → 假绿）。
pub fn versioned_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    // 尾部已是版本段（/v1、/v2 …）→ 不再追加
    let has_version = base
        .rsplit('/')
        .next()
        .map(|seg| {
            seg.len() > 1
                && seg.starts_with('v')
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        })
        .unwrap_or(false);
    if has_version {
        format!("{}/{}", base, path)
    } else {
        format!("{}/v1/{}", base, path)
    }
}

/// 构建 OpenAI 兼容 chat completion 请求体。
///
/// DeepSeek 思考型模型（如 deepseek-v4-flash）的 reasoning_content 与
/// content **共享 max_tokens 配额**——思考过长会耗尽预算导致 content 为空
/// （finish_reason=length）。2026-09-03 实机双爆：fix_mermaid 空结果卡死
/// 按钮、plan_course_llm 空响应导致"解析大纲 JSON 失败: EOF"。
///
/// 官方 API 用顶层 `thinking: {"type": "disabled"}` 关闭思考（注意不是
/// `reasoning_effort: "none"`，后者在官方端点返回 400）。其他 OpenAI
/// 兼容服务可能因未知字段报 400，所以只在 deepseek.com 端点注入。
pub fn openai_chat_body(
    model: &str,
    max_tokens: u32,
    prompt: &str,
    base_url: &str,
) -> serde_json::Value {
    let mut req = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    });
    if base_url.contains("deepseek.com") {
        req["thinking"] = serde_json::json!({"type": "disabled"});
    }
    req
}
