Feature: Cornell text marks (划词痕迹)

  As a learner in course mode
  I want selected text with Cornell Q&A to show a wavy underline in the reading pane
  So that I can see at a glance which passages I have asked about

  Scenario: Cue text in the reading pane gets a wavy mark
    Given a reading pane containing the text "位置编码是 Transformer 的关键组件"
    And a cue with id "cue-1" for the text "位置编码"
    When cue marks are injected
    Then the text "位置编码" should be wrapped in a cue mark for "cue-1"

  Scenario: Text occurring multiple times is marked only at the first occurrence
    Given a reading pane containing the text "晶格是晶体结构，晶格决定性质"
    And a cue with id "cue-2" for the text "晶格"
    When cue marks are injected
    Then exactly 1 cue mark should exist

  Scenario: Cue text not present in the reading pane is skipped silently
    Given a reading pane containing the text "完全无关的内容"
    And a cue with id "cue-3" for the text "位置编码"
    When cue marks are injected
    Then no cue mark should exist

  Scenario: Injecting the same cue twice does not duplicate the mark
    Given a reading pane containing the text "位置编码是 Transformer 的关键组件"
    And a cue with id "cue-1" for the text "位置编码"
    When cue marks are injected twice
    Then exactly 1 cue mark should exist

  Scenario: Hovering a cue mark shows the Q&A summary tooltip
    Given an injected cue mark for "cue-1" with 2 rounds of Q&A
    When the user hovers the cue mark
    Then a tooltip should show the cue summary with 2 rounds

  Scenario: Clicking a cue mark scrolls to the sidebar cue and flashes it
    Given an injected cue mark for "cue-1"
    And a sidebar cue card for "cue-1"
    When the user clicks the cue mark
    Then the sidebar cue card should be scrolled into view and flashed

  Scenario: Deleting a cue removes its mark from the reading pane
    Given an injected cue mark for "cue-1"
    When the cue mark for "cue-1" is removed
    Then no cue mark should exist
    And the original text should be restored
