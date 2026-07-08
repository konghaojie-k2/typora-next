/**
 * Paper Import — UI and orchestration for importing papers from PDF / URL.
 *
 * Keeps PaperReader untouched; this module only handles the conversion UI
 * and delegates the heavy lifting to Rust commands.
 */

(function (global) {
  'use strict';

  const IMPORT_STEPS = [
    { key: 'submit', label: '正在提交到 minerU...', percent: 15 },
    { key: 'poll', label: '正在解析论文...', percent: 50 },
    { key: 'download', label: '正在下载解析结果...', percent: 75 },
    { key: 'guide', label: '正在生成导读...', percent: 90 }
  ];

  const PaperImport = {
    /**
     * Render an import progress panel into `container`.
     */
    showProgress(container, stepKey, extraMessage) {
      if (!container) return;
      const step = IMPORT_STEPS.find(s => s.key === stepKey) || IMPORT_STEPS[0];
      const message = extraMessage || step.label;

      container.innerHTML = `
        <div class="paper-import-progress">
          <div class="paper-import-spinner"></div>
          <p class="paper-import-status">${message}</p>
          <div class="paper-import-bar">
            <div class="paper-import-bar-fill" style="width: ${step.percent}%;"></div>
          </div>
        </div>
      `;
    },

    /**
     * Remove the import progress UI.
     */
    hideProgress(container) {
      if (!container) return;
      const el = container.querySelector('.paper-import-progress');
      if (el) el.remove();
    },

    /**
     * Extract a display title from the first heading of imported markdown.
     */
    extractTitle(content) {
      if (!content) return null;
      const match = content.match(/^#\s+(.+)$/m);
      return match ? match[1].trim() : null;
    }
  };

  global.PaperImport = PaperImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PaperImport };
  }
})(typeof window !== 'undefined' ? window : global);
