//! Integration tests for quiz quality validation (quiz-distractor-quality C 层).
//!
//! Run with: cargo test --test quiz_quality_test

#[path = "../src/quiz_quality.rs"]
mod quiz_quality;

use quiz_quality::{check_label_question, check_quiz_json, LENGTH_RATIO_THRESHOLD};
use serde_json::json;

fn label_q(id: &str, texts: [&str; 4], correct: &str) -> serde_json::Value {
    json!({
        "id": id,
        "qtype": "single",
        "question": "q",
        "options": [
            {"label": "A", "text": texts[0]},
            {"label": "B", "text": texts[1]},
            {"label": "C", "text": texts[2]},
            {"label": "D", "text": texts[3]}
        ],
        "correct": correct
    })
}

#[test]
fn balanced_question_has_no_violations() {
    let q = label_q(
        "q1",
        [
            "子词级切分加兜底",
            "只用字符级切分",
            "词表无限扩大",
            "One-Hot 编码",
        ],
        "A",
    );
    assert!(check_label_question(&q, None).is_empty());
}

#[test]
fn length_ratio_above_threshold_is_flagged() {
    let q = label_q(
        "q2",
        [
            "想象一个巨大的国际象棋棋盘，每个格子里都放着一颗钢珠，钢珠之间被强力胶粘住，这就是离子在固体中的排列结构",
            "数据压缩算法",
            "数据库优化",
            "前端框架",
        ],
        "A",
    );
    let v = check_label_question(&q, None);
    assert_eq!(v.len(), 1);
    assert_eq!(v[0].kind, "length_ratio");
    assert_eq!(v[0].question_id, "q2");
}

#[test]
fn threshold_value_is_one_point_eight() {
    assert!((LENGTH_RATIO_THRESHOLD - 1.8).abs() < f64::EPSILON);
}

#[test]
fn verbatim_correct_against_chapter_is_flagged() {
    let sentence = "霍尔与埃鲁在1886年独立发明了将氧化铝溶解于熔融冰晶石通电电解的霍尔-埃鲁法";
    let chapter = format!("……正文……{}。后续内容……", sentence);
    let q = label_q(
        "q3",
        [
            sentence,
            "合理的干扰选项一",
            "合理的干扰选项二",
            "合理的干扰选项三",
        ],
        "A",
    );
    let v = check_label_question(&q, Some(&chapter));
    assert!(
        v.iter().any(|x| x.kind == "verbatim"),
        "expected verbatim violation, got {:?}",
        v
    );
}

#[test]
fn verbatim_ignores_whitespace_differences() {
    let sentence = "铝表面瞬间形成约4nm致密氧化膜，阻止进一步氧化，使铝在酸性食物中也稳定";
    let chapter =
        format!("铝表面瞬间形成约4nm致密氧化膜，\n阻止进一步氧化，\n使铝在酸性食物中也稳定。");
    let q = label_q(
        "q4",
        [
            sentence,
            "干扰一长度适中",
            "干扰二长度适中",
            "干扰三长度适中",
        ],
        "A",
    );
    let v = check_label_question(&q, Some(&chapter));
    assert!(v.iter().any(|x| x.kind == "verbatim"));
}

#[test]
fn paraphrased_correct_is_not_flagged() {
    let chapter = "霍尔与埃鲁在1886年独立发明了将氧化铝溶解于熔融冰晶石通电电解的霍尔-埃鲁法。";
    let q = label_q(
        "q5",
        [
            "电解法的关键是让氧化铝溶进熔融冰晶石再通电",
            "合理的干扰选项一",
            "合理的干扰选项二",
            "合理的干扰选项三",
        ],
        "A",
    );
    let v = check_label_question(&q, Some(chapter));
    assert!(
        !v.iter().any(|x| x.kind == "verbatim"),
        "paraphrase must not be flagged: {:?}",
        v
    );
}

#[test]
fn short_correct_skips_verbatim_check() {
    let chapter = "铜的导电更好但铝更轻，同重量下铝的导电能力是铜的两倍，所以高压线用铝。";
    let q = label_q(
        "q6",
        ["相同重量下铝导电是铜两倍", "干扰一", "干扰二", "干扰三"],
        "A",
    );
    let v = check_label_question(&q, Some(chapter));
    assert!(!v.iter().any(|x| x.kind == "verbatim"));
}

#[test]
fn non_single_questions_are_skipped() {
    let q = json!({"id": "s1", "qtype": "short", "question": "q", "options": [], "correct": null});
    assert!(check_label_question(&q, None).is_empty());
}

#[test]
fn check_quiz_json_walks_questions_array() {
    let doc = json!({
        "questions": [
            label_q("a", ["很长很长很长很长很长很长很长很长很长很长很长很长的正确项", "短", "短", "短"], "A"),
            label_q("b", ["均衡一", "均衡二", "均衡三", "均衡四"], "B"),
            {"id": "m", "qtype": "multiple", "question": "q", "options": [{"label":"A","text":"短"},{"label":"B","text":"很长很长很长很长很长很长很长很长很长很长很长很长很长很长"}], "correct": ["A"]}
        ]
    });
    let v = check_quiz_json(&doc, None);
    assert_eq!(v.len(), 1, "only the imbalanced single question: {:?}", v);
    assert_eq!(v[0].question_id, "a");
}

#[test]
fn missing_questions_field_yields_empty() {
    assert!(check_quiz_json(&json!({}), None).is_empty());
}
