//! Cleanup helpers for AI translation output.
//!
//! Pure-std module (no Tauri deps) so integration tests can `#[path]`-include
//! it directly — linking the full `app_lib` pulls in WebView2 and the test
//! exe fails to start in some Windows environments.

/// Strip an echoed `段落 N:` / `Paragraph N:` label from the start of a
/// translation segment.
///
/// `translate_text` labels input segments `段落 N:` so the model keeps order;
/// some models echo the label back into the translation, which then renders
/// verbatim in the preview. The prompt forbids echoing; this is the defensive
/// second layer and also repairs entries already poisoned in the translation
/// cache. Real translations starting without such a label pass through
/// untouched.
pub fn strip_translation_label(s: &str) -> String {
    let rest = s.trim_start();
    for kw in ["段落", "Paragraph", "paragraph"] {
        let Some(after_kw) = rest.strip_prefix(kw) else {
            continue;
        };
        let after_kw = after_kw.trim_start();
        let n_digits = after_kw.chars().take_while(|c| c.is_ascii_digit()).count();
        if n_digits == 0 {
            continue;
        }
        // ASCII digits are one byte each, so byte-indexing is safe here.
        let after_digits = &after_kw[n_digits..];
        let Some(body) = after_digits
            .strip_prefix(':')
            .or_else(|| after_digits.strip_prefix('：'))
        else {
            continue;
        };
        return body.trim_start().to_string();
    }
    s.to_string()
}
