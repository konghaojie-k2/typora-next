Feature: Per-question quiz explanations after submission

  As a learner reviewing a graded chapter quiz
  I want a per-question explanation panel
  So that I understand why the correct option is correct and where I went wrong

  Scenario: Building explanation items keeps the correct option text
    Given a graded quiz with two questions and one unanswered record
    When the explanation items are built
    Then the first item should point at the correct option text
    And the unanswered item should show no answer

  Scenario: Wrong answers expand by default
    Given a graded quiz with one wrong and one correct answer
    When the explanation items are built
    Then the wrong item should be expanded by default
    And the correct item should stay collapsed

  Scenario: AI explanations merge by question id
    Given explanation items for two questions
    When AI explanations arrive for one known id and one unknown id
    Then only the known item should carry an explanation
    And the unknown id should be ignored

  Scenario: Missing AI explanation keeps the correct answer visible
    Given explanation items for one question
    When AI explanations are empty
    Then the item should still expose its correct option text
    And one explanation should be reported missing

  Scenario: Explanation cache file is derived from the chapter name
    Given a chapter file named "03-mechanics.md"
    When the explanation cache file name is resolved
    Then the cache file name should end with explanations.json
    And the cache file should round-trip through a real learning directory

  Scenario: Result card exposes the explanation entry
    Given the learning result card source
    Then the result card should contain the explanation button
    And the result card should call the explanation command

  Scenario: Explanation module loads before the learning integration
    Given the index html source
    Then quiz-explanations.js should load before mode-integration.js
