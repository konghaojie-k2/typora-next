/**
 * External Refresh — 切回标签时的外部修改检测决策（Sprint 14）
 *
 * 背景：watcher 是单文件、随焦点切换的（main.js watchCurrentFile）。
 * 后台标签的文件被外部修改时既无监听也无提示，切回后渲染的仍是
 * 打开时缓存的 tab.content。本模块回答一个问题：重读磁盘后，
 * 要不要弹"已在外部修改"提示。
 *
 * 纯函数、无副作用；main.js 负责 IO（open_file）与时序（竞态保护）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ExternalRefresh = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /**
   * 是否应弹"已在外部修改"刷新提示。
   *
   * @param {string} cachedContent 标签打开时缓存的内容（tab.content）
   * @param {string|undefined|null} diskContent 重读磁盘得到的内容；读取失败传非字符串
   * @param {boolean} promptVisible 当前是否已有刷新提示在屏
   * @returns {boolean}
   *
   * 规则：
   * - 已有提示在屏 → 不重复弹
   * - 磁盘读取失败（非字符串）→ 被动检测永不误报
   * - 缓存缺失但磁盘内容有效 → 保守提示
   * - 磁盘与缓存不一致 → 提示
   */
  function shouldPromptExternalRefresh(cachedContent, diskContent, promptVisible) {
    if (promptVisible) return false;
    if (typeof diskContent !== 'string') return false;
    if (typeof cachedContent !== 'string') return true;
    return diskContent !== cachedContent;
  }

  return { shouldPromptExternalRefresh };
});
