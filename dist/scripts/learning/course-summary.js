/**
 * Course Summary - 学完课程后生成主题式幻灯片总结
 *
 * 链路：
 *   全部章节 completed → 自动弹窗（只弹一次）→ invoke('generate_summary')
 *     → agent 读全部章节写 <project>/99-课程总结.md（--- 分隔）
 *     → summary_complete → 读文件 → addTab → openSlides()（复用 Reveal.js 管线）
 *
 * 再次进入：
 *   - 面板「📊 总结」按钮（学完且文件存在时显示）
 *   - 侧边栏可见 99-课程总结.md → F5
 *
 * 纯函数（isCourseCompleted / getSummaryPath / shouldOfferSummary）导出给测试。
 */

(function() {
  'use strict';

  // Node.js compatibility: provide window/document if not defined
  if (typeof window === 'undefined') {
    global.window = {};
  }
  if (typeof document === 'undefined') {
    global.document = {
      createElement: (tag) => ({
        textContent: '',
        style: {},
        appendChild() {},
        remove() {},
        set onclick(fn) {},
        get onclick() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
      })
    };
  }

  const SUMMARY_FILE = '99-课程总结.md';
  let _summaryOffered = false; // 本次会话只弹一次确认框
  let _generating = false;     // 防止重复触发生成

  // ============================================
  // 纯函数（Node.js 可测）
  // ============================================
  function isCourseCompleted(manager) {
    if (!manager || !manager.chapters || manager.chapters.length === 0) return false;
    return manager.chapters.every(ch => ch.status === 'completed');
  }

  function getSummaryPath(projectPath) {
    const cleaned = String(projectPath || '').replace(/[\\/]+$/, '');
    return cleaned ? cleaned + '/' + SUMMARY_FILE : SUMMARY_FILE;
  }

  /**
   * 是否应该弹窗提示生成总结（决策纯函数）。
   * @param {object} manager - ChapterStatusManager（有 chapters）
   * @param {boolean} offered - 本会话是否已提示过
   * @param {boolean} summaryFileExists - 总结文件是否已存在
   */
  function shouldOfferSummary(manager, offered, summaryFileExists) {
    if (offered) return false;
    if (!isCourseCompleted(manager)) return false;
    if (summaryFileExists) return false;
    return true;
  }

  /**
   * 课程是否完结（读侧派生，Sprint 16）。
   * 完结 = project.json 顶层 course_status === 'completed'（写侧落盘）
   *   或全部章节状态为 completed/已完成（存量项目兼容，含 v1 chapter.status）。
   * @param {object} project - project.json 对象（{ chapters, chapters_status, course_status? }）
   */
  function isProjectCourseCompleted(project) {
    if (!project || typeof project !== 'object') return false;
    if (project.course_status === 'completed') return true;
    const chapters = Array.isArray(project.chapters) ? project.chapters : [];
    if (chapters.length === 0) return false;
    const cs = project.chapters_status || {};
    return chapters.every((ch) => {
      const s = (ch && ch.file && cs[ch.file]) || (ch && ch.status) || '';
      return s === 'completed' || s === '已完成';
    });
  }

  /**
   * Dashboard 复习入口展示决策（Sprint 16）。
   * 完结课程：入口常驻、不带计数徽标（不再催复习）；
   * 未完结：仅有到期项时显示，且带计数。
   * @returns {{visible: boolean, showCount: boolean, count: number}}
   */
  function getReviewEntrySpec(courseCompleted, dueCount) {
    const due = Number.isInteger(dueCount) && dueCount > 0 ? dueCount : 0;
    if (courseCompleted) {
      return { visible: true, showCount: false, count: 0 };
    }
    if (due > 0) {
      return { visible: true, showCount: true, count: due };
    }
    return { visible: false, showCount: false, count: 0 };
  }

  // ============================================
  // 文件系统
  // ============================================
  async function summaryExists(projectPath) {
    if (!window.__TAURI__ || !window.__TAURI__.fs) return false;
    try {
      const { exists } = window.__TAURI__.fs;
      return await exists(getSummaryPath(projectPath));
    } catch (e) {
      console.warn('[CourseSummary] summaryExists failed:', e);
      return false;
    }
  }

  // ============================================
  // UI：确认弹窗
  // ============================================
  function showConfirmDialog(message, confirmText, cancelText) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--color-bg-primary,#1f2937);border-radius:12px;padding:24px;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:inherit;';

      const msg = document.createElement('div');
      msg.style.cssText = 'margin-bottom:20px;font-size:14px;line-height:1.7;color:var(--color-text-primary,#e5e7eb);white-space:pre-line;';
      msg.textContent = message;
      box.appendChild(msg);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = cancelText || '暂不';
      cancelBtn.style.cssText = 'padding:8px 16px;border-radius:6px;border:1px solid var(--color-border,#374151);background:transparent;color:var(--color-text-secondary,#9ca3af);cursor:pointer;font-size:13px;';
      cancelBtn.onclick = () => { overlay.remove(); resolve(false); };
      actions.appendChild(cancelBtn);

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = confirmText || '生成总结';
      confirmBtn.style.cssText = 'padding:8px 16px;border-radius:6px;border:none;background:#4f46e5;color:#fff;cursor:pointer;font-size:13px;font-weight:500;';
      confirmBtn.onclick = () => { overlay.remove(); resolve(true); };
      actions.appendChild(confirmBtn);

      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  // ============================================
  // UI：生成中进度浮层
  // ============================================
  function showGenerationOverlay() {
    let overlay = document.getElementById('courseSummaryOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.id = 'courseSummaryOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99998;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--color-bg-primary,#1f2937);border-radius:12px;padding:24px;width:420px;max-height:60vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:inherit;';
    const title = document.createElement('div');
    title.style.cssText = 'margin-bottom:14px;font-size:15px;font-weight:600;color:var(--color-text-primary,#e5e7eb);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span class="spinner-inline"></span> 正在生成课程总结…';
    box.appendChild(title);
    const log = document.createElement('div');
    log.id = 'courseSummaryLog';
    log.style.cssText = 'flex:1;overflow-y:auto;font-size:12px;line-height:1.7;color:var(--color-text-secondary,#9ca3af);';
    box.appendChild(log);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeSummaryOverlay() {
    const overlay = document.getElementById('courseSummaryOverlay');
    if (overlay) overlay.remove();
  }

  function appendSummaryLog(overlay, text) {
    const logEl = overlay.querySelector('#courseSummaryLog');
    if (!logEl || !text) return;
    const isDone = text.startsWith('✓');
    const isActive = text.startsWith('📖') || text.startsWith('🔍');
    const line = document.createElement('div');
    line.className = 'log-line' + (isDone ? ' done' : isActive ? ' active' : '');
    if (isActive) {
      line.innerHTML = '<span class="spinner-inline"></span> ' + _escapeHtml(text);
    } else {
      line.textContent = text;
    }
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 30) {
      logEl.removeChild(logEl.firstChild);
    }
  }

  function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(msg, type) {
    if (window.showToast) window.showToast(msg, type || '');
  }

  // ============================================
  // 主流程
  // ============================================
  /**
   * 课程完成时调用：满足条件则弹窗一次。
   */
  async function maybeOfferSummary(projectPath, manager) {
    try {
      const fileExists = await summaryExists(projectPath);
      if (!shouldOfferSummary(manager, _summaryOffered, fileExists)) return;
      _summaryOffered = true; // 先标记，防止弹窗期间重复触发
      const confirmed = await showConfirmDialog(
        '🎉 课程完成！\n要不要生成一份 slide 总结，把整门课的核心知识点串起来？',
        '生成总结',
        '暂不'
      );
      if (confirmed) {
        await generateSummary(projectPath, manager);
      }
    } catch (e) {
      console.warn('[CourseSummary] maybeOfferSummary failed:', e);
    }
  }

  /**
   * 面板「📊 总结」按钮：文件已存在 → 放映；否则学完 → 生成；未学完 → 提示。
   */
  async function onSummaryButtonClick(projectPath, manager) {
    const fileExists = await summaryExists(projectPath);
    if (fileExists) {
      await openSummarySlides(projectPath);
    } else if (isCourseCompleted(manager)) {
      await generateSummary(projectPath, manager);
    } else {
      toast('学完课程后才能生成总结');
    }
  }

  /**
   * 触发生成：invoke('generate_summary') + 监听 summary 事件。
   * 事件驱动成功/失败；invoke 本身立即返回（Rust 后台跑）。
   */
  async function generateSummary(projectPath, manager) {
    if (_generating) {
      toast('总结正在生成中…');
      return;
    }
    if (!window.__TAURI__) return;
    _generating = true;
    const overlay = showGenerationOverlay();
    appendSummaryLog(overlay, '正在准备课程总结…');

    // 读 session_id（与滑窗预生成同源），让 agent 有项目记忆
    let sessionId = null;
    try {
      const { exists, readTextFile } = window.__TAURI__.fs;
      const sessionPath = String(projectPath).replace(/[\\/]+$/, '') + '/.learning/agent-session.json';
      if (await exists(sessionPath)) {
        const data = JSON.parse(await readTextFile(sessionPath));
        sessionId = data.session_id || null;
      }
    } catch (e) {
      console.warn('[CourseSummary] failed to read session, falling back to fresh:', e);
    }

    const outline = {
      name: (manager && manager.projectName) || '',
      chapters: (manager && manager.chapters || []).map(ch => ({
        title: ch.title,
        duration_minutes: ch.duration_minutes,
        concepts: ch.concepts || []
      }))
    };

    const unlisten = await listenForSummaryEvents(projectPath);

    try {
      await window.__TAURI__.core.invoke('generate_summary', { projectPath, outline, sessionId });
    } catch (e) {
      console.error('[CourseSummary] generate_summary invoke failed:', e);
      unlisten();
      _generating = false;
      closeSummaryOverlay();
      toast('❌ 总结生成失败: ' + (e.message || String(e)));
    }
  }

  /**
   * 监听 agent-event 中与总结相关的事件，驱动 UI 收尾。
   */
  async function listenForSummaryEvents(projectPath) {
    if (!window.__TAURI__ || !window.__TAURI__.event) return function() {};
    let settled = false;
    const unlisten = await window.__TAURI__.event.listen('agent-event', (event) => {
      const payload = event.payload || {};
      const type = payload.type;

      if (type === 'summary_complete') {
        if (settled) return;
        settled = true;
        unlisten();
        _generating = false;
        closeSummaryOverlay();
        toast('✓ 课程总结已生成');
        openSummarySlides(projectPath).catch(err =>
          console.warn('[CourseSummary] openSummarySlides after complete failed:', err)
        );
      } else if (type === 'summary_failed') {
        if (settled) return;
        settled = true;
        unlisten();
        _generating = false;
        closeSummaryOverlay();
        const msg = (payload.data && payload.data.message) || '未知错误';
        toast('❌ 总结生成失败: ' + msg);
      } else if (type === 'error') {
        // Rust 层进程级失败（bridge 崩溃等）
        if (settled) return;
        settled = true;
        unlisten();
        _generating = false;
        closeSummaryOverlay();
        const msg = (payload.data && payload.data.message) || '未知错误';
        toast('❌ 总结生成失败: ' + msg);
      } else if (type === 'progress_log' && payload.data && payload.data.text) {
        const overlay = document.getElementById('courseSummaryOverlay');
        if (overlay) appendSummaryLog(overlay, payload.data.text);
      }
    });
    return unlisten;
  }

  /**
   * 放映总结：读文件 → addTab（设为 active）→ openSlides()。
   */
  async function openSummarySlides(projectPath) {
    if (!window.__TAURI__ || !window.TyporaNext) return;
    const filePath = getSummaryPath(projectPath);
    const result = await window.__TAURI__.core.invoke('open_file', { path: filePath });
    if (!result || !result.content) {
      throw new Error('总结文件为空');
    }
    if (window.TyporaNext.addTab) {
      await window.TyporaNext.addTab(result.path, result.content, result.base_dir || '');
      if (window.TyporaNext.openSlides) {
        window.TyporaNext.openSlides();
      }
    }
  }

  // ============================================
  // Public API
  // ============================================
  window.CourseSummary = {
    SUMMARY_FILE,
    isCourseCompleted,
    getSummaryPath,
    shouldOfferSummary,
    isProjectCourseCompleted,
    getReviewEntrySpec,
    summaryExists,
    maybeOfferSummary,
    onSummaryButtonClick,
    generateSummary,
    openSummarySlides
  };

  // Export for Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isCourseCompleted, getSummaryPath, shouldOfferSummary, isProjectCourseCompleted, getReviewEntrySpec, summaryExists, SUMMARY_FILE };
  }
})();
