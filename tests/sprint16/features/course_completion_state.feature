Feature: 课程完结状态（Course Completion State）

  As a learner who finished all chapters
  I want the course to reach a terminal "completed" state
  So that re-entering the project shows a completion banner instead of nagging me to review

  # 写侧（最后一章完成时 project.json 落 course_status=completed）由
  # Rust 纯函数 mark_course_completed_if_done 实现，cargo test 覆盖；
  # 本 feature 覆盖读侧派生 + dashboard 展示决策 + Rust 接线静态检查。

  Scenario: project.json 已落 course_status=completed → 判定完结
    Given a real project.json on disk with course_status completed
    When project course completion is derived
    Then the course should be treated as completed

  Scenario: 全部章节已完成（英文状态）→ 派生为完结
    Given a real project.json on disk with all chapters completed
    When project course completion is derived
    Then the course should be treated as completed

  Scenario: 存量项目中文状态「已完成」→ 派生为完结
    Given a real project.json on disk with Chinese status values all completed
    When project course completion is derived
    Then the course should be treated as completed

  Scenario: 还有章节未完成 → 未完结
    Given a real project.json on disk with a chapter still not completed
    When project course completion is derived
    Then the course should not be treated as completed

  Scenario: 空章节项目 → 未完结
    Given a real project.json on disk with no chapters
    When project course completion is derived
    Then the course should not be treated as completed

  Scenario: 已完结课程的复习入口常驻且不带计数徽标
    Given a completed course with 3 due review items
    When the review entry spec is computed
    Then the review entry should be visible without a count badge

  Scenario: 已完结课程无到期项时复习入口仍常驻
    Given a completed course with 0 due review items
    When the review entry spec is computed
    Then the review entry should be visible without a count badge

  Scenario: 未完结课程的复习入口带计数徽标（回归）
    Given an active course with 3 due review items
    When the review entry spec is computed
    Then the review entry should show the count 3

  Scenario: 无到期复习的未完结课程不显示复习入口（回归）
    Given an active course with 0 due review items
    When the review entry spec is computed
    Then the review entry should be hidden

  # 实机反馈（2026-08-12）：仅去计数徽标不够，橙红渐变按钮本身仍是视觉催促
  Scenario: 已完结课程的复习入口为平静样式（不催促）
    Given a completed course with 3 due review items
    When the review entry spec is computed
    Then the review entry should use the calm style

  Scenario: 未完结有到期课程的复习入口保持提醒态（回归）
    Given an active course with 3 due review items
    When the review entry spec is computed
    Then the review entry should use the urgent style

  # 实机反馈（2026-08-12）：图谱 dashboard 元素溢出触发滚轮，必须一屏看完
  Scenario: dashboard 源码接入 calm 样式与一屏看完布局
    Given the real dashboard source and stylesheet
    Then the dashboard should wire the calm class and fit-to-screen rendering

  Scenario: Rust 持久化路径接入完结标记
    Given the real lib.rs source
    Then persist_quiz_result should call the course completion marker
