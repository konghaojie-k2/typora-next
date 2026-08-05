Feature: Quiz option shuffle (position-bias rescue)

  As a learner taking quizzes and reviews
  I want options shuffled at render time with the correct answer remapped
  So that fixed-position legacy questions cannot be gamed by memorizing slots

  Scenario: Legacy review card with answer at 0 keeps correct content after shuffle
    Given a legacy review card whose answer is at position 0
    When the review modal shuffles its questions
    Then the shuffled answer should point to the original correct text

  Scenario: Chapter quiz correct label follows its text after shuffle
    Given a chapter quiz question whose correct label is A
    When the quiz modal shuffles its questions
    Then the new correct label should point to the original correct text
    And the relabeled options should be consecutive A to D

  Scenario: Grading stays consistent on shuffled questions
    Given a chapter quiz question whose correct label is A
    When the quiz modal shuffles its questions
    And the user picks the new correct label
    Then the answer should be graded correct

  Scenario: A batch of legacy 0-position cards spreads across slots
    Given 20 legacy review cards whose answers are all at position 0
    When the review modal shuffles them with distinct seeds
    Then the correct positions should cover at least 3 distinct slots
