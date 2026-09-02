Feature: 课程内容元素约束（engineering 域 + D 层硬校验）

  As a learner taking an engineering/process course (electrolytic aluminum, semiconductor etching)
  I want chapters with real formulas, real process flows and real industrial instances —
  and with no pseudocode or programming code blocks, even enforced post-generation
  So that the material fits industrial/engineering subjects instead of a software template

  行为层（element_compliance 校验器 / agent-bridge element-repair / plan_prompt）由
  Rust test（element_compliance_test、plan_prompt_test）与 JS unit（test_element_repair）覆盖；
  本 feature 验收 skill 内容约束、判定接入与全链路接线。

  # PB20-1: engineering 课程域

  Scenario: SKILL.md 定义 engineering 域及其元素约束
    Given the bundled chapter-generation skill
    Then SKILL.md should define the engineering course type
    And SKILL.md should ban programming code blocks for engineering
    And SKILL.md should require real formulas for engineering
    And SKILL.md should require real industrial instances for engineering
    And SKILL.md should include engineering in the inference heuristic
    And SKILL.md should have an engineering item in the MUST-VERIFY per-type block

  Scenario: content-format.md 提供 engineering 变体
    Given the chapter-generation content-format spec
    Then the spec should be version 1.3
    And the spec should have an engineering template branch
    And engineering branch should allow real formulas but no code blocks

  # PB20-2: 硬约束（D 层元素合规扫描 + 违规重写）

  Scenario: engineering 域判定接入全链路
    Given the real ai_agent.rs and lib.rs sources
    Then build_plan_prompt should enumerate engineering
    And generate_chapters should accept engineering course_type
    And generate_chapters should persist engineering course_type

  Scenario: element_compliance 校验器实现存在且接线
    Given the real element_compliance source
    And the real ai_agent.rs and lib.rs sources
    Then element_compliance should expose check_chapter
    And generate_chapters should scan element violations and trigger element-repair

  Scenario: agent-bridge 提供 element-repair 定向重写
    Given the real agent-bridge.mjs source
    Then agent-bridge should implement element-repair
    And element-repair should instruct only fixing flagged code blocks

  Scenario: examples.md 含 engineering 镜像片段
    Given the chapter-generation examples reference
    Then examples should include an engineering fragment without code blocks
