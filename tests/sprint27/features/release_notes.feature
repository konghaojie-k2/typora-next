Feature: 发布前验证当前版本的更新说明

  Scenario: 正式版本使用自己的更新说明
    Given release notes exist for version "0.4.14"
    When release notes are checked for tag "v0.4.14"
    Then the release notes check should pass
    And only the current version notes should be published

  Scenario: 缺少当前版本说明时阻止发布
    Given release notes are missing for version "0.4.14"
    When release notes are checked for tag "v0.4.14"
    Then the release notes check should fail with "缺少版本 0.4.14"

  Scenario: 只有占位内容时阻止发布
    Given placeholder release notes for version "0.4.14"
    When release notes are checked for tag "v0.4.14"
    Then the release notes check should fail with "没有实际更新内容"

  Scenario: 发布标签必须匹配应用版本
    Given release notes exist for version "0.4.14"
    When release notes are checked for tag "v0.4.15"
    Then the release notes check should fail with "与应用版本"
