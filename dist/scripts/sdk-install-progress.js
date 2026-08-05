/**
 * SDK Install Progress — pi SDK 安装进度的状态机（纯函数，可测试）
 *
 * 设计背景（pi-install-progress，2026-08-05）：新电脑自动安装 pi SDK 时
 * npm install 黑盒执行数分钟，前端只有静态文案。现在 Rust 侧
 * `install_pi_sdk` 命令流式 emit `sdk-install-progress` 事件
 * （{stage, message}），本模块把事件流折叠为 UI 状态：
 * 阶段文案 + 最新 npm 输出行 + 成功/失败终态与可读原因。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SdkInstallProgress = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /** Rust 侧 stage → 用户可读阶段文案（与 ai_agent.rs emit 的 stage 对应） */
  const STAGE_LABELS = {
    prepare: '准备安装目录…',
    download: '下载依赖中…',
    verify: '校验安装结果…'
  };

  /** 初始状态：点击"自动安装"后立即进入 installing */
  function createInstallState() {
    return {
      phase: 'installing',
      stage: '开始安装…',
      lastLine: '',
      error: ''
    };
  }

  /**
   * 折叠一条进度事件。终态（success/failed）后到达的迟到事件被忽略。
   * @param {{phase: string, stage: string, lastLine: string, error: string}} state
   * @param {?{stage?: string, message?: string}} event
   */
  function applyProgress(state, event) {
    if (!state || state.phase !== 'installing' || !event) return state;
    const stage = STAGE_LABELS[event.stage] || state.stage;
    const lastLine =
      event.stage === 'download' && event.message ? event.message : state.lastLine;
    return { phase: state.phase, stage, lastLine, error: state.error };
  }

  /**
   * 折叠 install_pi_sdk 的最终返回，进入终态。
   * @param {?{status?: string, error?: string}} result
   */
  function applyResult(state, result) {
    if (!state) return state;
    if (result && result.status === 'installed') {
      return { phase: 'success', stage: '安装完成', lastLine: state.lastLine, error: '' };
    }
    const error =
      result && result.error ? String(result.error) : '安装失败：未知错误，请重试';
    return { phase: 'failed', stage: '安装失败', lastLine: state.lastLine, error };
  }

  return { STAGE_LABELS, createInstallState, applyProgress, applyResult };
});
