/**
 * Update Progress — 更新下载进度的状态机（纯函数，可测试）
 *
 * 设计背景（2026-09-09 实测）：0.4.2 → 0.4.3 更新时点击「更新」
 * 后横幅消失、全程无进度无状态。根因：performUpdate 的状态只写 About 面板
 * 内的 #updateStatus（未打开时不可见），且 downloadAndInstall 未接 onEvent
 * Channel，tauri-plugin-updater 的 Started/Progress/Finished 事件全部丢弃。
 *
 * 本模块把下载事件流折叠为 UI 状态：下载中（含百分比/MB）→ 安装中 →
 * 重启中 / 失败终态。DOM 渲染在 main.js，本模块只负责状态。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.UpdateProgress = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /**
   * 初始状态：点击「更新」后立即进入 downloading。
   * @param {string} version 目标版本号
   */
  function createDownloadState(version) {
    return {
      phase: 'downloading', // downloading | installing | restart | failed | cancelled
      version: version || '',
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      error: ''
    };
  }

  function computePercent(downloaded, total) {
    if (!total || total <= 0) return 0;
    return Math.min(100, Math.round((downloaded / total) * 100));
  }

  /**
   * 折叠一条 tauri-plugin-updater 下载事件。
   * 仅 downloading 阶段接受事件；进入终态后迟到事件被忽略。
   * @param {?object} state
   * @param {?{event: string, data?: {contentLength?: number, chunkLength?: number}}} event
   */
  function applyDownloadEvent(state, event) {
    if (!state || state.phase !== 'downloading' || !event) return state;
    const data = event.data || {};
    if (event.event === 'Started') {
      const total = data.contentLength || 0;
      return { ...state, totalBytes: total, percent: computePercent(state.downloadedBytes, total) };
    }
    if (event.event === 'Progress') {
      const downloaded = state.downloadedBytes + (data.chunkLength || 0);
      return { ...state, downloadedBytes: downloaded, percent: computePercent(downloaded, state.totalBytes) };
    }
    if (event.event === 'Finished') {
      return { ...state, phase: 'installing' };
    }
    return state;
  }

  /** downloadAndInstall 完整 resolve → 即将重启 */
  function applySuccess(state) {
    if (!state || state.phase === 'cancelled') return state;
    return { ...state, phase: 'restart' };
  }

  /** 下载/安装失败 → 失败终态（卡片可关闭） */
  function applyFailure(state, err) {
    if (!state || state.phase === 'cancelled') return state;
    const error = err && err.message ? String(err.message) : String(err || '未知错误');
    return { ...state, phase: 'failed', error };
  }

  function applyCancellation(state) {
    if (!state || state.phase !== 'downloading') return state;
    return { ...state, phase: 'cancelled', error: '' };
  }

  /** 字节 → MB（保留一位小数） */
  function formatMB(bytes) {
    return (bytes / 1048576).toFixed(1);
  }

  /**
   * 各阶段的用户可读文案。下载文案显式标注 GitHub 来源——更新包托管在
   * GitHub Releases，直连较慢/不稳定时用户能理解等待原因。
   * 下载中：有总大小 → 「正在从 GitHub 下载更新… 18.0/36.0 MB（50%）」；
   *         无总大小 → 「正在从 GitHub 下载更新… 5.0 MB」（不显示百分比）。
   */
  function statusText(state) {
    if (!state) return '';
    switch (state.phase) {
      case 'downloading':
        if (state.totalBytes > 0) {
          return `正在从 GitHub 下载更新… ${formatMB(state.downloadedBytes)}/${formatMB(state.totalBytes)} MB（${state.percent}%）`;
        }
        return `正在从 GitHub 下载更新… ${formatMB(state.downloadedBytes)} MB`;
      case 'installing':
        return '下载完成，正在安装…';
      case 'restart':
        return '更新完成，正在重启…';
      case 'failed':
        return `更新失败：${state.error}`;
      case 'cancelled':
        return '更新已取消';
      default:
        return '';
    }
  }

  return {
    createDownloadState,
    applyDownloadEvent,
    applySuccess,
    applyFailure,
    applyCancellation,
    statusText,
    formatMB
  };
});
