Feature: Agent SDK startup guidance

  As a new user of Typora Next
  I want to be guided when the Agent SDK is missing at startup
  So that I know AI learning features require it and how to install it (GitHub issue #2)

  Scenario: SDK missing at startup shows guidance toast
    Given the Agent SDK is not found on the system
    And the user has not dismissed the guidance before
    When the app starts and probes for the Agent SDK
    Then the guidance toast should be shown

  Scenario: SDK present at startup shows no toast
    Given the Agent SDK is found on the system
    When the app starts and probes for the Agent SDK
    Then the guidance toast should not be shown

  Scenario: Dismissed guidance stays hidden on next launch
    Given the Agent SDK is not found on the system
    And the user has dismissed the guidance before
    When the app starts and probes for the Agent SDK
    Then the guidance toast should not be shown

  Scenario: Clicking 不再提示 persists dismissal
    Given the Agent SDK is not found on the system
    And the user has not dismissed the guidance before
    When the app starts and probes for the Agent SDK
    And the user clicks 不再提示
    Then the guidance toast should be hidden
    And the dismissal should be persisted

  Scenario: 自动安装 succeeds clears dismissal and hides toast
    Given the Agent SDK is not found on the system
    And the user has dismissed the guidance before
    When the user clicks 自动安装 and the SDK becomes available
    Then the guidance toast should be hidden
    And the dismissal should be cleared
