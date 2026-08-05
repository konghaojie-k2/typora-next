Feature: SDK install progress visualization

  As a user installing the Pi coding agent
  I want to see install progress (stage + streaming npm output)
  So that the multi-minute npm install is not a silent black box

  Scenario: Clicking 自动安装 shows progress area with stage text
    Given the install progress UI is ready
    When the user clicks 自动安装
    And a progress event with stage prepare arrives
    Then the progress area should be visible
    And the stage text should show "准备安装目录…"

  Scenario: Download stage streams npm output lines
    Given the install progress UI is ready
    When the user clicks 自动安装
    And a progress event with stage download and line "npm http fetch GET 200 registry" arrives
    Then the stage text should show "下载依赖中…"
    And the last npm output line should show "npm http fetch GET 200 registry"

  Scenario: Later download lines replace earlier ones
    Given the install progress UI is ready
    When the user clicks 自动安装
    And a progress event with stage download and line "npm http fetch GET 200 first" arrives
    And a progress event with stage download and line "npm http fetch GET 200 second" arrives
    Then the last npm output line should show "npm http fetch GET 200 second"

  Scenario: Verify stage updates stage text
    Given the install progress UI is ready
    When the user clicks 自动安装
    And a progress event with stage verify arrives
    Then the stage text should show "校验安装结果…"

  Scenario: Install succeeds hides the guidance toast
    Given the install progress UI is ready
    When the user clicks 自动安装
    And the install command finishes with status installed
    Then the install state should be success
    And the guidance toast should be hidden

  Scenario: Install fails shows readable reason and allows retry
    Given the install progress UI is ready
    When the user clicks 自动安装
    And the install command finishes with status failed and reason "网络连接失败，无法访问 npm 仓库"
    Then the install state should be failed
    And the readable error should show "网络连接失败，无法访问 npm 仓库"
    And the install button should be retryable

  Scenario: Progress events after a terminal state are ignored
    Given the install progress UI is ready
    When the user clicks 自动安装
    And the install command finishes with status failed and reason "网络连接失败"
    And a progress event with stage download and line "late line" arrives
    Then the install state should be failed
    And the last npm output line should still be empty

  Scenario: Install command throwing counts as failure
    Given the install progress UI is ready
    And the install command will throw an invoke error
    When the user clicks 自动安装
    Then the install state should be failed
    And the install button should be retryable
