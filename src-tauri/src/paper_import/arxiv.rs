//! URL normalization for academic paper URLs.
//!
//! Currently supports arXiv abstract pages and direct PDF links.
//! Other URLs must already point to a `.pdf` file.

use regex::Regex;

/// Normalize a user-provided paper URL into a minerU-consumable PDF URL.
///
/// Supported inputs:
/// - `https://arxiv.org/abs/2401.12345` → `https://arxiv.org/pdf/2401.12345.pdf`
/// - `https://arxiv.org/abs/2401.12345v1` → `https://arxiv.org/pdf/2401.12345v1.pdf`
/// - `https://arxiv.org/pdf/2401.12345` → `https://arxiv.org/pdf/2401.12345.pdf`
/// - direct `.pdf` link → returned as-is
///
/// Unsupported URLs return an error asking the user to download the PDF first.
pub fn normalize_paper_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL 不能为空".to_string());
    }

    // arXiv abstract page.
    let abs_re = Regex::new(r"https?://arxiv\.org/abs/(\d+\.\d+(?:v\d+)?)").map_err(|e| e.to_string())?;
    if let Some(caps) = abs_re.captures(trimmed) {
        let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        return Ok(format!("https://arxiv.org/pdf/{}.pdf", id));
    }

    // arXiv PDF page (may lack .pdf suffix).
    let pdf_re = Regex::new(r"https?://arxiv\.org/pdf/(\d+\.\d+(?:v\d+)?)").map_err(|e| e.to_string())?;
    if let Some(caps) = pdf_re.captures(trimmed) {
        let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        return Ok(format!("https://arxiv.org/pdf/{}.pdf", id));
    }

    // Already a direct PDF link.
    if trimmed.to_lowercase().ends_with(".pdf") {
        return Ok(trimmed.to_string());
    }

    Err("目前仅支持 arXiv 页面或直接 PDF 链接，请先下载 PDF 后再导入".to_string())
}

/// Extract a display-friendly source name from a URL or file path.
pub fn source_name_from_url(url: &str) -> String {
    let trimmed = url.trim();

    // arXiv id.
    let re = Regex::new(r"arxiv\.org/(?:abs|pdf)/(\d+\.\d+(?:v\d+)?)").ok();
    if let Some(caps) = re.as_ref().and_then(|r| r.captures(trimmed)) {
        if let Some(id) = caps.get(1) {
            return format!("arxiv-{}", id.as_str());
        }
    }

    // Last path segment.
    trimmed
        .split('/')
        .next_back()
        .unwrap_or("paper")
        .split('?')
        .next()
        .unwrap_or("paper")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_arxiv_abs_to_pdf() {
        assert_eq!(
            normalize_paper_url("https://arxiv.org/abs/2401.12345").unwrap(),
            "https://arxiv.org/pdf/2401.12345.pdf"
        );
    }

    #[test]
    fn test_arxiv_abs_with_version() {
        assert_eq!(
            normalize_paper_url("https://arxiv.org/abs/2401.12345v2").unwrap(),
            "https://arxiv.org/pdf/2401.12345v2.pdf"
        );
    }

    #[test]
    fn test_arxiv_pdf_without_suffix() {
        assert_eq!(
            normalize_paper_url("https://arxiv.org/pdf/2401.12345").unwrap(),
            "https://arxiv.org/pdf/2401.12345.pdf"
        );
    }

    #[test]
    fn test_arxiv_pdf_with_suffix() {
        assert_eq!(
            normalize_paper_url("https://arxiv.org/pdf/2401.12345.pdf").unwrap(),
            "https://arxiv.org/pdf/2401.12345.pdf"
        );
    }

    #[test]
    fn test_direct_pdf_link() {
        assert_eq!(
            normalize_paper_url("https://example.com/paper.pdf").unwrap(),
            "https://example.com/paper.pdf"
        );
    }

    #[test]
    fn test_unsupported_url() {
        assert!(normalize_paper_url("https://example.com/paper").is_err());
    }

    #[test]
    fn test_empty_url() {
        assert!(normalize_paper_url("   ").is_err());
    }

    #[test]
    fn test_source_name_arxiv() {
        assert_eq!(
            source_name_from_url("https://arxiv.org/abs/2401.12345"),
            "arxiv-2401.12345"
        );
    }

    #[test]
    fn test_source_name_direct_pdf() {
        assert_eq!(
            source_name_from_url("https://example.com/my-paper.pdf?download=1"),
            "my-paper.pdf"
        );
    }
}
