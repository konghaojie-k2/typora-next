/**
 * Agent Init — SDK 初始化与使用期检测的决策函数（纯函数，可测试）
 *
 * 设计原则（用户 2026-08-04 提出）：安装（初始化）≠ 使用检测。
 * 首启给一次性初始化引导；之后 SDK 缺失只在状态芯片/用时错误里体现，
 * 不再自动弹引导 toast。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.AgentInit = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /**
   * 启动时的动作决策
   * @param {{sdkFound: boolean, initDone: boolean, dismissed: boolean}} s
   * @returns {'mark-init-done'|'none'|'show-init-toast'}
   *   mark-init-done: SDK 就绪即视为已初始化（静默记 flag，什么都不弹）
   *   none:           已初始化或已忽略 → 什么都不弹（缺失仅芯片体现）
   *   show-init-toast:首次且未忽略 → 一次性初始化引导
   */
  function decideStartupAction(s) {
    if (s.sdkFound) return 'mark-init-done';
    if (s.initDone || s.dismissed) return 'none';
    return 'show-init-toast';
  }

  /**
   * SDK 已就绪时，是否提示用户配置 API Key（一次性提示）
   * @param {{hasKey: boolean, prompted: boolean}} s
   */
  function shouldPromptMissingApiKey(s) {
    return !s.hasKey && !s.prompted;
  }

  return { decideStartupAction, shouldPromptMissingApiKey };
});
