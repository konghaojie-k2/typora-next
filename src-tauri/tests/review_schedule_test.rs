//! Review schedule logic tests
//! Tests Ebbinghaus interval computation independent of app_lib linking.
//!
//! Sprint 4: 遗忘曲线提醒系统

// ============================================
// Pure logic (copied from planned implementation)
// ============================================

fn compute_next_interval(review_count: u32, rating: &str) -> u32 {
    let intervals = [1u32, 2, 4, 7, 15, 30];
    let base = intervals[std::cmp::min(review_count as usize, intervals.len() - 1)];
    match rating {
        "struggling" => std::cmp::max(1, base / 2),
        "learning" => std::cmp::max(1, (base as f32 * 0.75) as u32),
        _ => base,
    }
}

fn is_due(next_review_at: &str) -> bool {
    // Format "YYYY-MM-DD HH:MM:SS" supports lexicographic comparison
    let now = current_time_string();
    next_review_at <= &now
}

fn current_time_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    format_timestamp(now)
}

fn format_timestamp(ts: i64) -> String {
    // Simple formatting: assume UTC for test consistency
    let days_since_epoch = ts / 86400;
    let secs_of_day = (ts % 86400) as u32;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;

    // Convert days since epoch to YYYY-MM-DD (approximate, good enough for tests)
    let (year, month, day) = days_to_ymd(days_since_epoch);

    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        year, month, day, hour, minute, second
    )
}

fn days_to_ymd(mut days: i64) -> (i32, u32, u32) {
    // Approximate conversion from days since 1970-01-01
    let mut year = 1970i32;
    loop {
        let year_days = if is_leap_year(year) { 366 } else { 365 };
        if days < year_days {
            break;
        }
        days -= year_days;
        year += 1;
    }
    let month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u32;
    for (idx, &md) in month_days.iter().enumerate() {
        let md = if idx == 1 && is_leap_year(year) {
            29
        } else {
            md
        };
        if days < md {
            month = (idx + 1) as u32;
            break;
        }
        days -= md;
        month = (idx + 2) as u32;
    }
    (year, month, (days + 1) as u32)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn yesterday_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    format_timestamp(now - 86400)
}

fn tomorrow_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    format_timestamp(now + 86400)
}

// ============================================
// Tests
// ============================================

#[test]
fn test_ebbinghaus_base_intervals() {
    assert_eq!(compute_next_interval(0, "mastered"), 1);
    assert_eq!(compute_next_interval(1, "mastered"), 2);
    assert_eq!(compute_next_interval(2, "mastered"), 4);
    assert_eq!(compute_next_interval(3, "mastered"), 7);
    assert_eq!(compute_next_interval(4, "mastered"), 15);
    assert_eq!(compute_next_interval(5, "mastered"), 30);
    assert_eq!(compute_next_interval(6, "mastered"), 30);
    assert_eq!(compute_next_interval(99, "mastered"), 30);
}

#[test]
fn test_struggling_shortens_interval() {
    assert_eq!(compute_next_interval(0, "struggling"), 1);
    assert_eq!(compute_next_interval(1, "struggling"), 1);
    assert_eq!(compute_next_interval(2, "struggling"), 2);
    assert_eq!(compute_next_interval(3, "struggling"), 3);
    assert_eq!(compute_next_interval(4, "struggling"), 7);
    assert_eq!(compute_next_interval(5, "struggling"), 15);
}

#[test]
fn test_learning_reduces_interval() {
    assert_eq!(compute_next_interval(0, "learning"), 1);
    assert_eq!(compute_next_interval(1, "learning"), 1);
    assert_eq!(compute_next_interval(2, "learning"), 3);
    assert_eq!(compute_next_interval(3, "learning"), 5);
    assert_eq!(compute_next_interval(4, "learning"), 11);
    assert_eq!(compute_next_interval(5, "learning"), 22);
}

#[test]
fn test_unknown_rating_fallback() {
    assert_eq!(compute_next_interval(2, "unknown"), 4);
}

#[test]
fn test_is_due_past_date() {
    let s = yesterday_string();
    assert!(is_due(&s), "yesterday ({}) should be due", s);
}

#[test]
fn test_is_due_future_date() {
    let s = tomorrow_string();
    assert!(!is_due(&s), "tomorrow ({}) should not be due", s);
}

#[test]
fn test_is_due_invalid_format() {
    assert!(!is_due("not-a-date"), "invalid date should not be due");
}

#[test]
fn test_interval_never_zero() {
    for count in 0..10 {
        for rating in ["mastered", "learning", "struggling", "unknown"] {
            let interval = compute_next_interval(count, rating);
            assert!(
                interval >= 1,
                "interval should never be zero: count={}, rating={}, got={}",
                count,
                rating,
                interval
            );
        }
    }
}
