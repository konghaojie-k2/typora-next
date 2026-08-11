Feature: 划词解释回答截断修复（Explain Raw-Quote Parsing）

  As a learner reading explanations with follow-up Q&A
  I want answers containing quoted terms to render in full
  So that I don't see half a sentence when the model writes raw ASCII quotes

  # 行为层由 Rust explain_parse 模块覆盖（cargo test --test explain_parse_test，
  # 含 2026-08-11 真实 bug 样本）；本 feature 验收接线与源头预防约束。

  Scenario: explanation skill 禁止半角双引号（源头预防）
    Given the real bundled explanation skill
    Then the skill should forbid raw ASCII double quotes in output text

  Scenario: 解析核心在独立模块且被 parse_explain_response 委托（接线）
    Given the real ai_agent.rs source
    Then parse_explain_response should delegate to explain_parse
    And lib.rs should register the explain_parse module
