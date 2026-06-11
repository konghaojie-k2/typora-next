Feature: Theme Switch (系统深色模式下切换生效)

  作为使用 typora-next 阅读 Markdown 的用户
  我希望主题切换按钮在系统处于深色模式时也能正确切到浅色
  以便我在系统深色 + app 浅色阅读的场景下不被打扰

  背景:
    应用通过 <html data-theme="light|dark"> 标记当前主题
    CSS 用 [data-theme="dark"] 显式深色 + @media (prefers-color-scheme: dark) :root:not([data-theme]) 系统深色回退
    关键不变量：data-theme 永远存在（值是 light 或 dark），确保 :root:not([data-theme]) 永远不命中

  Scenario: 系统深色模式下用户从深色切到浅色应该变浅
    Given 系统处于深色模式
    And 应用当前显示深色主题
    When 用户点击切换主题按钮
    Then 应用应该切换到浅色主题
    And data-theme 属性应该存在且值为 "light"
    And data-theme 不应该被移除（不能为空）

  Scenario: 系统深色模式下用户切一次到浅色后再切一次回到深色
    Given 系统处于深色模式
    And 应用当前显示深色主题
    When 用户连续两次点击切换主题按钮
    Then 应用应该最终显示深色主题
    And data-theme 属性应该存在且值为 "dark"

  Scenario: 系统浅色模式下用户从浅色切到深色应该变深
    Given 系统处于浅色模式
    And 应用当前显示浅色主题
    When 用户点击切换主题按钮
    Then 应用应该切换到深色主题
    And data-theme 属性应该存在且值为 "dark"

  Scenario: 系统浅色模式下用户连续点击两次应该回到浅色
    Given 系统处于浅色模式
    And 应用当前显示浅色主题
    When 用户连续两次点击切换主题按钮
    Then 应用应该最终显示浅色主题
    And data-theme 属性应该存在且值为 "light"

  Scenario: 首次启动时跟随系统主题
    Given 系统处于深色模式
    And 用户从未手动选择过主题
    When 应用启动并完成初始化
    Then 应用应该显示深色主题
    And data-theme 属性应该存在且值为 "dark"
