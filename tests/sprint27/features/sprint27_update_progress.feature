Feature: 更新下载进度可见性（Sprint 27）

  As a user upgrading Typora Next (e.g. 0.4.2 → 0.4.3)
  I want to see persistent download progress and stage status after clicking 更新
  So that 几分钟的 GitHub 下载不再是黑盒，我知道它在动、动了多少、卡没卡死

  背景（2026-09-09 实测）：v0.4.2 点「更新」后横幅消失，全程无进度条无状态。
  根因有二：
    ① performUpdate 的状态文字只写 About 面板内的 #updateStatus，面板未打开时不可见
    ② downloadAndInstall 未传 onEvent Channel，tauri-plugin-updater 的
       Started/Progress/Finished 进度事件全部丢弃
  附带修复：About 面板手动检查到更新后只有「请更新」文案，没有任何安装入口。

  状态折叠逻辑由真实模块 dist/scripts/update-progress.js 提供；
  检查/下载走真实 dist/scripts/updater.js（mock __TAURI__.core.invoke + Channel）。

  # PB27-1: 进度卡片可见性

  Scenario: 启动检测到更新时横幅提供明确入口
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.3"
    When the update check runs on startup
    Then the update banner should be visible
    And the banner should offer 安装更新 and 取消 actions
    And the update should link to release notes for version "0.4.3"
    And the banner should mention GitHub 下载来源

  Scenario: 点击更新后横幅原地变形为常驻进度卡片
    Given a shown update banner for version "0.4.3"
    When the user clicks 更新
    Then the banner should switch to progress mode
    And the progress card should show 正在从 GitHub 下载更新
    And the progress card should remain visible without opening the About panel

  # PB27-2: 进度数据接线

  Scenario: 下载进度事件驱动百分比与 MB 显示
    Given a shown update banner for version "0.4.3"
    And the user clicks 更新
    When the download starts with total 37748736 bytes
    And a chunk of 18874368 bytes arrives
    Then the progress card should show percent 50
    And the progress card should show "18.0/36.0 MB"
    When a chunk of 18874368 bytes arrives
    Then the progress card should show percent 100

  Scenario: 服务端无总大小时降级显示已下载量
    Given a shown update banner for version "0.4.3"
    And the user clicks 更新
    When the download starts with total 0 bytes
    And a chunk of 5242880 bytes arrives
    Then the progress card should show "5.0 MB"
    And the progress card should not show a percent

  Scenario: 下载完成后依次进入安装与重启阶段
    Given a shown update banner for version "0.4.3"
    And the user clicks 更新
    When the download starts with total 1048576 bytes
    And a chunk of 1048576 bytes arrives
    And the download finishes
    Then the progress card should show 正在安装
    When the install promise resolves
    Then the progress card should show 正在重启

  # PB27-3: 失败兜底 + 手动入口

  Scenario: 下载失败显示错误且卡片可关闭
    Given a shown update banner for version "0.4.3"
    And the user clicks 更新
    When the download fails with "network unreachable"
    Then the progress card should show 更新失败
    And the progress card should show "network unreachable"
    And the progress card should be closable

  Scenario: 关于面板手动检查到更新也能发起安装
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.3"
    When the user checks for updates from the About panel
    Then the About status should show 发现新版本
    And the update banner should be visible
    And the banner should offer 安装更新 and 取消 actions
    And the banner should mention GitHub 下载来源

  # PB27-4: 版本号常驻可见（升级测试可一眼确认当前运行版本）

  Scenario: 工具栏常驻显示当前版本号
    Given the real index.html toolbar
    Then the toolbar should contain a version chip element
    And main.js should fill the version chip from get_app_info at startup

  # PB27-5: 检查失败透出真实错误（不误报「未配置」）

  Scenario: 网络错误显示真实原因而非误报未配置
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.3"
    And the mocked update check fails with "error sending request for url"
    When the user checks for updates from the About panel
    Then the About status should show 检查更新失败
    And the About status should contain "error sending request for url"

  Scenario: 真正未配置时才显示未配置文案
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.3"
    And the mocked update check fails with updater-not-configured
    When the user checks for updates from the About panel
    Then the About status should show 更新服务未配置

  # PB27-6: 代理感知（GitHub 直连失败环境）
  # 背景（2026-09-09 实测）：updater 检查报 error sending request——
  # reqwest 未开 system-proxy feature，GUI 进程又继承不到终端 HTTPS_PROXY。
  # 修复：Rust get_proxy_config（env → Windows 注册表）+ check 传 proxy 参数；
  # Update 资源在 check 时固化代理配置，download_and_install 自动沿用。

  Scenario: 检测到代理时检查更新走代理
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.3"
    And the mocked system proxy is "http://127.0.0.1:7890"
    When the user checks for updates from the About panel
    Then the update check should have been called with proxy "http://127.0.0.1:7890"

  Scenario: 无代理时按原样直连
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.3"
    And the mocked system proxy is absent
    When the user checks for updates from the About panel
    Then the update check should have been called without proxy

  Scenario: Rust 代理解析优先级与格式归一化
    Then the proxy_config rust test should exist and pass

  # PB27-7: onEvent 必填回归（2026-09-09 实爆：v0.4.3 应用内升级必败）
  # v0.4.3 的 downloadAndInstall() 不传回调 → onEvent: undefined 被 JSON
  # 序列化丢弃 → 插件命令缺必填 key 报 invalid args。此后必须永远携带 Channel。

  Scenario: 不传回调下载也必须携带 onEvent Channel
    Given the updater module with a mocked Tauri core
    And the mocked latest version is "0.4.4"
    When the download is invoked without a progress callback
    Then the download request should carry an onEvent channel
