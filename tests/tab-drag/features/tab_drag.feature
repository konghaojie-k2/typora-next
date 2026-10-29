Feature: Tab 页拖拽重排
  用户可以按住 tab 左右拖动调整顺序，像 Chrome/VSCode 一样。
  拖拽过程中不改 state（renderTabs 的点击/关闭处理器闭包捕获 index，
  中途重排会让点击指向错误文件），松手时才提交重排并重映射 activeTab。

  Scenario: 向右拖过一个相邻 tab
    Given 打开的 tab 顺序为 a.md / b.md / c.md
    When 用户把第 1 个 tab 向右拖过第 2 个 tab 的中点并松手
    Then tab 顺序应变为 b.md / a.md / c.md

  Scenario: 向左拖到首位
    Given 打开的 tab 顺序为 a.md / b.md / c.md
    When 用户把第 3 个 tab 向左拖过第 1 个 tab 的中点并松手
    Then tab 顺序应变为 c.md / a.md / b.md

  Scenario: 拖动的 tab 保持激活
    Given 打开的 tab 顺序为 a.md / b.md / c.md
    And 当前激活第 2 个 tab
    When 用户把第 2 个 tab 向左拖过第 1 个 tab 的中点并松手
    Then tab 顺序应变为 b.md / a.md / c.md
    And 激活的仍是 b.md

  Scenario: 拖后台 tab 越过激活 tab 时激活不丢
    Given 打开的 tab 顺序为 a.md / b.md / c.md
    And 当前激活第 1 个 tab
    When 用户把第 2 个 tab 向左拖过第 1 个 tab 的中点并松手
    Then tab 顺序应变为 b.md / a.md / c.md
    And 激活的仍是 a.md

  Scenario: 位移小于阈值视为点击不重排
    Given 打开的 tab 顺序为 a.md / b.md / c.md
    When 用户在第 1 个 tab 上按下后移动不足阈值并松手
    Then tab 顺序应保持 a.md / b.md / c.md

  Scenario: 拖回原位松手顺序不变
    Given 打开的 tab 顺序为 a.md / b.md / c.md
    When 用户拖动第 1 个 tab 但回到原位置松手
    Then tab 顺序应保持 a.md / b.md / c.md

  Scenario: tab-drag 模块先于 main.js 加载
    Given 真实的 index.html
    Then 页面应在 main.js 之前加载 tab-drag 模块
