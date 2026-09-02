Feature: 结课 roadmap（📍 下一站）与课程总结功能删除

  As a learner who just completed a course
  I want to see recommended next-stage directions with evidence-based reasons
  So that I know where to go next without needing a systematic mental model

  行为层（prompt 构建 / 响应解析 / 三态渲染 / snapHours / 卡片回调）由：
  - cargo test --test roadmap_prompt_test（12 个）
  - node tests/sprint22/unit/test_course_roadmap.js（8 个）
  覆盖；本 feature 验收全链路接线 + 课程总结删除的反向断言。

  # PB22-1: 后端

  Scenario: generate_roadmap 命令与纯模块接线
    Given the real roadmap_prompt source
    Then it should expose build_roadmap_prompt and parse_roadmap_response
    And the prompt should require evidence-based reasons
    And parsing should normalize levels and cap at three directions
    Given the real ai_agent.rs source
    Then generate_roadmap should cache to roadmap.json under .learning
    And regenerate with exclusion accumulation when intent is present
    And it should use a direct ureq call with both providers
    Given the real lib.rs source
    Then generate_roadmap command should be registered
    And roadmap_prompt module should be declared

  # PB22-2: 前端

  Scenario: dashboard 集成 roadmap 区块
    Given the real frontend sources for roadmap
    Then index.html should load course-roadmap.js
    And the dashboard should render the roadmap section only for completed courses
    And project-resume should pass projectPath to the dashboard
    And card click should prefill the create dialog without submitting

  Scenario: 换一批与意向 chip
    Given the real frontend sources for roadmap
    Then course-roadmap.js should offer reshuffle and three intent chips
    And styles for roadmap cards should exist

  # PB22-3: 课程总结彻底删除（反向断言）

  Scenario: 课程总结代码已移除
    Given the real lib.rs source
    Then generate_summary should not be registered
    Given the real ai_agent.rs source
    Then generate_summary should not be defined
    And the deleted summary files should be gone from disk
    And no frontend file should reference course-summary
