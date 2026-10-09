/**
 * Learning Mode UI Integration
 * Connects QuizPanel + SelectionExplainer to the main UI
 *
 * UI integration layer
 *
 * Provides:
 * 1. enhanceLearningMode() - Replaces !concept/!question/!quiz callouts with interactive cards
 * 2. setupQuizPanel() - Adds "掌握了吗？" DOM area + scroll listener
 * 3. setupSelectionExplainer() - Floating toolbar on text selection
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') return;
  if (!window.LearningProgress || !window.QuizPanel || !window.SelectionExplainer || !window.ElementRenderer) {
    console.warn('[LearningModeIntegration] Required modules not loaded');
  }

  let _quizPanel = null;
  let _selectionExplainer = null;
  let _quizAreaEl = null;
  let _scrollListenerBound = false;
  let _projectPath = '';
  let _lastQuizSubmission = null;
  let _reviewModal = null;
  let _reviewCheckInProgress = false;
  let _reviewLoadingEl = null;

  // Cornell Sidebar state
  let _cornellSidebarEl = null;      // sidebar DOM element
  let _cornellCueIdCounter = 0;      // cue ID counter
  let _cornellCues = [];             // cue data array
  let _currentChapterTitle = '';     // current chapter title for context
  let _currentChapterFile = '';      // current chapter file path (for persistence)
  let _lastChapterFileForSidebar = ''; // detect chapter switch
  // Note: extra questions are now persisted to disk (.learning/extras/*.json)
  // and loaded on demand — no in-memory cache needed.

  function formatLocalTime(date) {
    const d = date || new Date();
    const pad = n => String(n).padStart(2, '0');
    // getFullYear/getHours etc use system timezone (UTC+8), no offset needed
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // ============================================
  // 1. Enhance Learning Elements (callouts → cards)
  // ============================================

  /**
   * Scan markdownBody for GitHub Alert callouts and replace with interactive cards
   * Triggered after each renderMarkdown() call
   */
  function enhanceLearningElements() {
    console.log('enhanceLearningElements called');
    const inCourse = window.AppWorkspace?.isIn('course') ?? document.body.classList.contains('learning-mode');
    if (!inCourse) { console.log('not in course workspace, skip'); return; }

    const md = document.getElementById('markdownBody');
    if (!md) return;

    const allBlockquotes = md.querySelectorAll('blockquote:not([data-enhanced])');
    let enhanced = 0;

    allBlockquotes.forEach(bq => {
      const fullText = bq.textContent.trim();
      if (!fullText) return;

      // Detect callout type from rendered header (initObsidianCallouts has already transformed the structure)
      const iconEl = bq.querySelector('.obsidian-callout-icon');
      const titleEl = bq.querySelector('.obsidian-callout-title-text');
      const icon = iconEl ? iconEl.textContent.trim() : '';
      const title = titleEl ? titleEl.textContent.trim() : '';
      let type = null;

      if (icon === '❓') {
        type = 'question';
      } else if (icon === '📝' || (icon === 'ℹ️' && fullText.includes('小测验'))) {
        type = 'quiz';
      } else if (icon === '💡' || title === 'Answer' || title === '答案') {
        type = 'answer';
      } else if (icon === 'ℹ️') {
        type = 'concept';
      }

      if (!type) return;

      // Mark as enhanced
      bq.dataset.enhanced = 'true';
      bq.dataset.enhancedType = type;

      if (type === 'answer') {
        // Let answer be an independent collapsible callout, don't merge
        return;
      }

      if (type === 'concept') {
        enhanceConceptCallout(bq);
      } else if (type === 'question') {
        enhanceQuestionCallout(bq);
      } else if (type === 'quiz') {
        enhanceQuizCallout(bq);
      }
      enhanced++;
    });

    console.log('enhanced', enhanced, 'callout blocks');
  }

  // ============================================
  // Concept: keep original callout, no extra interaction needed
  // ============================================
  function enhanceConceptCallout(bq) {
    // Concept callouts are already visually distinct (blue border + ℹ️ emoji)
    // No additional interaction needed - content is fully expanded by default
    // This function is a no-op placeholder for future concept interactions
  }

  // ============================================
  // Question: let initObsidianCallouts handle collapse, no extra button needed
  // ============================================
  function enhanceQuestionCallout(bq) {
    // No-op: question callout already supports collapse via [!question]- syntax
    // initObsidianCallouts handles the toggle; we just preserve the structure
  }

  // ============================================
  // Quiz: clean up checkmarks only, leave nested answer as independent callout
  // ============================================
  function enhanceQuizCallout(bq) {
    // Clean checkmarks from options
    bq.querySelectorAll('li').forEach(li => {
      li.innerHTML = li.innerHTML.replace(/[✓✅]/g, '');
    });
    // Let nested answer callout remain as-is — initObsidianCallouts handles collapse
  }

  // ============================================
  // 2. Quiz Panel: "掌握了吗？" area + scroll trigger
  // ============================================

  function setupQuizPanel(chapterFile, projectPath) {
    console.log('setupQuizPanel called, chapterFile:', chapterFile, 'projectPath:', projectPath);
    if (!window.QuizPanel) { console.warn('QuizPanel not loaded'); return; }
    const inCourse = window.AppWorkspace?.isIn('course') ?? document.body.classList.contains('learning-mode');
    if (!inCourse) { console.log('not in course workspace, skip quiz'); return; }

    _projectPath = projectPath || '';
    _currentChapterFile = chapterFile || '';
    console.log('setupQuizPanel projectPath=', _projectPath, 'chapterFile=', _currentChapterFile);
    _quizPanel = new window.QuizPanel({ chapterFile: chapterFile || 'unknown' });
    _quizPanel.onSaveHistory = onQuizSaveHistory;
    _quizPanel.onAdaptRequested = onQuizAdaptRequested;
    injectQuizArea();
    bindScrollListener();
  }

  function injectQuizArea() {
    // Check if quiz area still exists in DOM (renderMarkdown may have cleared it)
    if (_quizAreaEl && _quizAreaEl.isConnected) return;
    _quizAreaEl = null; // Reset if removed from DOM
    const md = document.getElementById('markdownBody');
    if (!md) return;

    _quizAreaEl = document.createElement('div');
    _quizAreaEl.id = 'learningQuizArea';
    _quizAreaEl.className = 'learning-quiz-area';
    _quizAreaEl.style.cssText = 'margin-top: 60px; padding: 20px; border-top: 2px dashed #4f46e5; display: none;';
    _quizAreaEl.innerHTML = `
      <div class="quiz-area-header" style="font-size: 18px; font-weight: 600; color: #4f46e5; margin-bottom: 12px;">
        🎯 掌握了吗？
      </div>
      <div class="quiz-area-body" id="learningQuizAreaBody">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="quiz-area-start-btn" id="learningQuizStartBtn" style="
            padding: 10px 20px;
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
          ">开始测验</button>
          <button id="extraReviewBtn" style="
            padding: 10px 20px; background: #f5f3ff; color: #7c3aed;
            border: 1px solid #c4b5fd; border-radius: 6px;
            font-size: 14px; cursor: pointer; display: none;
          ">📝 附加题回顾</button>
        </div>
      </div>
    `;
    md.appendChild(_quizAreaEl);

    // Bind start button
    const startBtn = document.getElementById('learningQuizStartBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => onQuizStart());
    }

    // Bind extra review button — generates missing per-cue quizzes on demand, then displays
    const extraBtn = document.getElementById('extraReviewBtn');
    if (extraBtn) {
      const originalLabel = extraBtn.textContent;
      extraBtn.addEventListener('click', async () => {
        // Loading state: disable button + show spinner during generation
        extraBtn.disabled = true;
        extraBtn.textContent = '⏳ 生成中...';
        try {
          // Ensure: generate per-cue quizzes for any cue that doesn't have one yet.
          // This is the only place that triggers generation (avoiding blocking on every persist).
          await window.__TAURI__.core.invoke('ensure_extra_questions', {
            chapterFile: _currentChapterFile,
            projectPath: _projectPath
          });
          const rawExtras = await window.__TAURI__.core.invoke('load_extra_questions', {
            chapterFile: _currentChapterFile,
            projectPath: _projectPath
          });
          // 渲染前 shuffle 选项：存量题正确项位置强偏（quiz-distractor-quality B 层）
          const QS = typeof window !== 'undefined' ? window.QuizShuffle : null;
          const extras = QS ? QS.shuffleLabelQuestions(rawExtras) : rawExtras;
          if (extras && extras.length) {
            showExtraReviewModal(extras);
          } else {
            if (window.showToast) window.showToast('暂无附加题', 'info');
          }
        } catch (err) {
          console.warn('[ExtraReview] load failed:', err);
          if (window.showToast) window.showToast('加载附加题失败', 'error');
        } finally {
          extraBtn.disabled = false;
          extraBtn.textContent = originalLabel;
        }
      });
    }
  }

  function bindScrollListener() {
    if (_scrollListenerBound) return;
    _scrollListenerBound = true;

    let lastProgress = 0;
    const scrollContainer = document.getElementById('markdownBody');
    const scroller = scrollContainer || window;

    // Prevent scroll chaining that causes blank white space beyond content
    if (scrollContainer) {
      scrollContainer.style.overscrollBehavior = 'contain';
    }

    scroller.addEventListener('scroll', () => {
      let progress = 0;
      if (scrollContainer) {
        const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        progress = maxScroll > 0 ? scrollContainer.scrollTop / maxScroll : 0;
      } else {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        progress = docHeight > 0 ? window.scrollY / docHeight : 0;
      }
      console.log('scroll progress:', Math.round(progress * 100) + '%');
      if (progress - lastProgress > 0.05 || progress >= 0.8) {
        lastProgress = progress;
        if (_quizPanel) _quizPanel.notifyScrollProgress(progress);
        if (progress >= 0.8 && _quizAreaEl && _quizAreaEl.style.display === 'none') {
          showQuizArea();
        }
      }
    }, { passive: true });
  }

  function showQuizArea() {
    if (!_quizAreaEl) return;
    _quizAreaEl.style.display = 'block';
    if (_quizPanel) _quizPanel.notifyScrollProgress(1.0);
    restoreQuizResultCard();
    // Show "附加题回顾" button whenever there are cues with content (generation happens on click)
    updateExtraReviewButton();
  }

  // Synchronous button visibility: shown iff there are cues that could have extras.
  // No Tauri call — avoids blocking on agent spawns during persistCue/deleteCue.
  function updateExtraReviewButton() {
    const btn = document.getElementById('extraReviewBtn');
    if (!btn) return;
    btn.style.display = _cornellCues.length > 0 ? '' : 'none';
  }

  async function loadQuizHistory() {
    if (!_projectPath) return null;
    try {
      const data = await window.__TAURI__.core.invoke('read_quiz_history', { projectPath: _projectPath });
      return data || { version: '1.0', entries: [] };
    } catch (err) {
      console.warn('[QuizHistory] load failed:', err);
      return null;
    }
  }

  function getChapterBasename(chapterFile) {
    if (!chapterFile) return '';
    const parts = chapterFile.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || chapterFile;
  }

  async function restoreQuizResultCard() {
    if (!_quizPanel || !_quizAreaEl) return;
    const history = await loadQuizHistory();
    if (!history || !history.entries || !history.entries.length) return;

    const chapterBasename = getChapterBasename(_quizPanel.getChapterFile());
    const lastEntry = history.entries.slice().reverse().find(e => {
      const entryFile = e.chapter_file || '';
      return entryFile === chapterBasename || chapterBasename.endsWith(entryFile) || entryFile.endsWith(chapterBasename);
    });
    if (!lastEntry) return;

    // Build submission-compatible object for renderQuizResultCard
    const submission = {
      chapterFile: _quizPanel.getChapterFile(),
      rating: lastEntry.rating,
      score: lastEntry.score,
      weakConcepts: lastEntry.weak_concepts || [],
      answerRecords: (lastEntry.answers || []).map(a => ({
        question_id: a.question_id,
        qtype: a.qtype,
        user_answer: a.user_answer,
        is_correct: a.is_correct
      })),
      correctCount: (lastEntry.answers || []).filter(a => a.is_correct === true).length,
      totalScored: (lastEntry.answers || []).filter(a => a.qtype !== 'short').length,
      timestamp: lastEntry.timestamp
    };

    renderQuizResultCard(submission);
  }

  // ============================================
  // Quiz Modal: full-screen exam overlay
  // ============================================
  let _quizModal = null;
  let _currentQuizQuestions = [];

  async function onQuizStart() {
    console.log('[QuizDebug] onQuizStart called, _quizPanel=', !!_quizPanel);
    if (!_quizPanel) { console.warn('[QuizDebug] _quizPanel is null'); return; }

    // Reset if user previously closed mid-quiz or retaking after graded
    const state = _quizPanel.getState();
    if (state === 'answering' || state === 'submitting' || state === 'graded') {
      console.log('[QuizDebug] resetting panel from state:', state);
      _quizPanel.reset();
    }

    try {
      const chapterFile = _quizPanel.getChapterFile();
      console.log('[QuizDebug] chapterFile=', chapterFile, 'projectPath=', _projectPath);
      const result = await window.__TAURI__.core.invoke('generate_chapter_quiz', { chapterFile, projectPath: _projectPath });
      // 渲染前 shuffle 选项：存量题正确项位置强偏（quiz-distractor-quality B 层）
      const QS = typeof window !== 'undefined' ? window.QuizShuffle : null;
      const standard = QS
        ? QS.shuffleLabelQuestions(result.standard || [])
        : (result.standard || []);
      console.log('[QuizDebug] loaded questions:', standard.length, 'standard');
      // Only standard questions go into the quiz modal; extras have a separate entry point.
      _currentQuizQuestions = standard;
      if (_quizPanel) _quizPanel.setQuestions(standard);
      _quizPanel.startAnswering();
      console.log('[QuizDebug] showing modal...');
      showQuizModal(standard);
    } catch (err) {
      console.error('[QuizDebug] onQuizStart error:', err);
      const msg = (err && err.message) || String(err);
      if (window.showToast) {
        window.showToast('加载测验失败: ' + msg, 'error');
      }
      // Tauri WebView: alert()/confirm() don't work — rely on showToast above.
      // (Previously had `alert(...)` as a fallback, but that also fails to render.)
    }
  }

  function removeModalDom() {
    const existingDom = document.getElementById('learningQuizModal');
    if (existingDom) existingDom.remove();
    if (_quizModal) {
      _quizModal.remove();
      _quizModal = null;
    }
  }

  function showQuizModal(questions) {
    console.log('[QuizDebugShow] showing modal for', questions.length, 'questions');
    removeModalDom(); // Only remove DOM, do NOT reset panel state

    const allCount = questions.length;

    const modal = document.createElement('div');
    modal.id = 'learningQuizModal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10002;
      padding: 24px;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: #ffffff;
      border-radius: 16px;
      max-width: 680px;
      width: 100%;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
      box-shadow: 0 25px 80px rgba(0,0,0,0.25), 0 8px 24px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(229,231,235,0.8);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 18px 24px;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(8px);
      z-index: 1;
      border-radius: 16px 16px 0 0;
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 32px; height: 32px; background: linear-gradient(135deg,#4f46e5,#7c3aed); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 15px;">🎯</div>
        <div>
          <div style="font-size: 16px; font-weight: 700; color: #111827;">掌握了吗？</div>
          <div style="font-size: 12px; color: #6b7280;">共 ${questions.length} 题 · 答完提交即可查看结果</div>
        </div>
      </div>
      <button id="quizModalClose" style="
        width: 32px; height: 32px; background: #f3f4f6; border: none; border-radius: 8px;
        font-size: 16px; cursor: pointer; color: #6b7280; display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      " onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">✕</button>
    `;

    // Body
    const body = document.createElement('div');
    body.id = 'quizModalBody';
    body.style.cssText = 'padding: 24px; flex: 1; background: #fafafa;';

    questions.forEach((q, idx) => {
      const qEl = renderQuestionBlock(q, idx);
      body.appendChild(qEl);
    });

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 16px 24px;
      border-top: 1px solid #f3f4f6;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      bottom: 0;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(8px);
      z-index: 1;
      border-radius: 0 0 16px 16px;
    `;
    footer.innerHTML = `
      <span style="font-size: 13px; color: #9ca3af;">答完所有题目后点击提交</span>
      <button id="quizModalSubmit" style="
        padding: 10px 24px; background: linear-gradient(135deg,#4f46e5,#7c3aed); color: white;
        border: none; border-radius: 8px; font-size: 14px;
        font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(79,70,229,0.25);
        transition: transform 0.1s;
      " onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'">提交答案</button>
    `;

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);
    _quizModal = modal;

    document.getElementById('quizModalClose').addEventListener('click', closeQuizModal);
    document.getElementById('quizModalSubmit').addEventListener('click', onQuizModalSubmit);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeQuizModal();
    });
  }

  /**
   * Render a single question block element for the quiz modal.
   * @param {object} q - QuizQuestion object
   * @param {number} displayIdx - display number (0-based)
   * @returns {HTMLElement}
   */
  function renderQuestionBlock(q, displayIdx) {
    const qEl = document.createElement('div');
    qEl.style.cssText = `
      margin-bottom: 20px;
      padding: 18px 20px;
      background: white;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      transition: border-color 0.15s;
    `;
    qEl.dataset.qid = q.id;
    qEl.dataset.qtype = q.qtype;

    let optionsHtml = '';
    if (q.options && q.options.length) {
      const inputType = q.qtype === 'multiple' ? 'checkbox' : 'radio';
      const name = `q_${q.id}`;
      optionsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">` + q.options.map((opt) => `
        <label class="quiz-modal-option" style="
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px 12px;
          border: 1px solid #e5e7eb; border-radius: 8px;
          cursor: pointer; transition: all 0.15s; background: white;
        " onmouseover="this.style.borderColor='#4f46e5';this.style.background='#f5f3ff'"
           onmouseout="this.style.borderColor='#e5e7eb';this.style.background='white'"
           onclick="const cb=this.querySelector('input');cb.checked=!cb.checked;event.preventDefault();"
        >
          <input type="${inputType}" name="${name}" value="${opt.label}"
            style="margin-top: 3px; accent-color: #4f46e5; flex-shrink: 0;" onclick="event.stopPropagation();">
          <span style="font-size: 14px; color: #374151; line-height: 1.5;">
            <strong style="color: #111827;">${opt.label}.</strong> ${opt.text}
          </span>
        </label>
      `).join('') + `</div>`;
    } else if (q.qtype === 'short') {
      optionsHtml = `
        <textarea class="quiz-short-answer" data-qid="${q.id}" placeholder="请在此输入你的回答..." style="
          width: 100%; min-height: 90px; padding: 12px;
          border: 1px solid #d1d5db; border-radius: 8px;
          font-size: 14px; line-height: 1.6; resize: vertical;
          font-family: inherit; background: white;
        "></textarea>
      `;
    }

    qEl.innerHTML = `
      <div style="font-size: 15px; font-weight: 600; color: #1f2937; margin-bottom: 12px; line-height: 1.5;">
        <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #f3f4f6; border-radius: 6px; color: #4f46e5; font-size: 13px; margin-right: 8px;">${displayIdx + 1}</span>
        ${q.question}
        ${q.qtype === 'multiple' ? '<span style="font-size: 12px; color: #9ca3af; font-weight: 500; margin-left: 6px;">多选</span>' : ''}
      </div>
      <div class="quiz-options">${optionsHtml}</div>
    `;
    return qEl;
  }

  /**
   * 渲染「本题讨论的对象」——该 cue 的划选原文（可能是公式、表格或代码）。
   *
   * 单行按引用条呈现；多行按代码块呈现（等宽 + 保留缩进）。两种都用 pre-wrap，
   * 否则代码里的连续空格会被 HTML 折叠掉（`gp:hasUnit      gp:Gram ;`）。
   * 内容来自用户划选，含 < > & 等字符，必须转义后再进 innerHTML。
   */
  function renderExtraContext(context) {
    const text = (context || '').trim();
    if (!text) return '';

    const isMultiline = text.includes('\n');
    const style = isMultiline
      ? 'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px;' +
        'line-height:1.6; max-height:220px; overflow:auto;'
      : 'font-size:13px; line-height:1.6;';

    return `
      <div style="margin-bottom:12px; padding:10px 12px; background:#f8fafc;
                  border-left:3px solid #c4b5fd; border-radius:0 8px 8px 0;
                  color:#475569; white-space:pre-wrap; word-break:break-word; ${style}">${escapeHtml(text)}</div>
    `;
  }

  /**
   * Show a lightweight self-check modal for extra questions.
   * Clicking an option immediately shows correct/incorrect — no submission, no rating.
   */
  function showExtraReviewModal(extraQuestions) {
    if (!extraQuestions || !extraQuestions.length) return;

    const existing = document.getElementById('extraReviewModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'extraReviewModal';
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(15,23,42,0.35);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10004; padding: 24px;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #fff; border-radius: 16px;
      max-width: 600px; width: 100%;
      max-height: calc(100vh - 48px); overflow-y: auto;
      box-shadow: 0 25px 80px rgba(0,0,0,0.2);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `padding: 16px 20px; border-bottom: 1px solid #f3f4f6;
      display: flex; justify-content: space-between; align-items: center;
      position: sticky; top: 0; background: rgba(255,255,255,0.95);
      border-radius: 16px 16px 0 0;
    `;
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">📝</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:#7c3aed;">附加题回顾</div>
          <div style="font-size:12px;color:#8b5cf6;">${extraQuestions.length} 题 · 点击选项即时查看正误</div>
        </div>
      </div>
      <button id="extraReviewClose" style="width:28px;height:28px;background:#f3f4f6;border:none;border-radius:6px;font-size:14px;cursor:pointer;color:#6b7280;">✕</button>
    `;

    // Body with questions
    const body = document.createElement('div');
    body.style.cssText = 'padding: 20px; background: #fafafa;';

    extraQuestions.forEach((q, idx) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        margin-bottom: 16px; padding: 16px;
        background: white; border-radius: 12px;
        border: 1px solid #ddd6fe; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      `;

      // 题干可能说「关于这段…查询」，指代的对象（划选的原文/代码）必须同屏可见，
      // 否则题目不可作答——弹窗里只有题干和选项，没有章节正文可参照。
      // 本 cue 的划选内容由后端从解释文件带出（QuizQuestion.context）。
      const contextHtml = renderExtraContext(q.context);

      const questionHtml = `
        ${contextHtml}
        <div style="font-size:14px;font-weight:600;color:#1f2937;margin-bottom:12px;line-height:1.5;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#ede9fe;border-radius:5px;color:#7c3aed;font-size:12px;margin-right:8px;">${idx + 1}</span>
          ${q.question}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
      `;

      let optionsHtml = '';
      q.options.forEach((opt) => {
        const isCorrect = q.correct === opt.label;
        optionsHtml += `
          <div class="extra-option" data-correct="${isCorrect}" style="
            display:flex;align-items:flex-start;gap:8px;
            padding:8px 12px; border:1px solid #e5e7eb; border-radius:8px;
            cursor:pointer; transition:all 0.15s; background:white;
            font-size:13px; color:#374151;
          " onmouseover="this.style.borderColor='#c4b5fd';this.style.background='#f5f3ff'"
             onmouseout="this.style.borderColor='#e5e7eb';this.style.background='white'">
            <span style="
              display:inline-flex;align-items:center;justify-content:center;
              width:20px;height:20px;border-radius:999px;
              background:#f3f4f6;color:#6b7280;font-size:11px;font-weight:600;flex-shrink:0;
            ">${opt.label}</span>
            <span>${opt.text}</span>
          </div>
        `;
      });

      optionsHtml += `</div>`;
      wrapper.innerHTML = questionHtml + optionsHtml;
      body.appendChild(wrapper);

      // Bind click handlers for self-check
      wrapper.querySelectorAll('.extra-option').forEach(el => {
        el.addEventListener('click', () => {
          const wasCorrect = el.dataset.correct === 'true';
          // Disable further clicks on this question
          wrapper.querySelectorAll('.extra-option').forEach(sibling => {
            sibling.style.cursor = 'default';
            sibling.onmouseover = null;
            sibling.onmouseout = null;
          });
          // Highlight selection
          el.style.borderColor = wasCorrect ? '#10b981' : '#ef4444';
          el.style.background = wasCorrect ? '#ecfdf5' : '#fef2f2';
          // Show check/cross icon
          const badge = el.querySelector('span:first-child');
          if (badge) {
            badge.textContent = wasCorrect ? '✓' : '✗';
            badge.style.background = wasCorrect ? '#10b981' : '#ef4444';
            badge.style.color = 'white';
          }
          // Reveal correct answer if wrong
          if (!wasCorrect) {
            wrapper.querySelectorAll('.extra-option').forEach(sibling => {
              if (sibling.dataset.correct === 'true') {
                sibling.style.borderColor = '#10b981';
                sibling.style.background = '#ecfdf5';
                const sb = sibling.querySelector('span:first-child');
                if (sb) {
                  sb.textContent = '✓';
                  sb.style.background = '#10b981';
                  sb.style.color = 'white';
                }
              }
            });
          }
        });
      });
    });

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('extraReviewClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  async function onQuizSaveHistory(historyPayload) {
    if (!_projectPath) {
      console.warn('[QuizSaveHistory] no projectPath, skipping persistence');
      return;
    }
    try {
      // Build answer records from panel answers + result metadata
      const panelAnswers = historyPayload.answers || {};
      const answerRecords = (historyPayload.questions || []).map(q => {
        const raw = panelAnswers[q.id];
        let userAnswer = raw === undefined ? null : raw;
        let isCorrect = null;
        if (q.qtype === 'single') {
          isCorrect = userAnswer === q.correct;
        } else if (q.qtype === 'multiple') {
          const correctSet = new Set(q.correct || []);
          const userSet = new Set(Array.isArray(userAnswer) ? userAnswer : []);
          isCorrect = correctSet.size === userSet.size && [...correctSet].every(v => userSet.has(v));
        }
        return {
          question_id: q.id,
          qtype: q.qtype,
          user_answer: userAnswer,
          is_correct: isCorrect
        };
      });

      const payload = {
        projectPath: _projectPath,
        chapterFile: historyPayload.chapter || '',
        rating: historyPayload.result.rating,
        score: historyPayload.result.score,
        weakConcepts: historyPayload.result.weak_concepts || [],
        answers: answerRecords,
        timestamp: formatLocalTime()
      };

      await window.__TAURI__.core.invoke('persist_quiz_result', payload);
      console.log('[QuizSaveHistory] persisted quiz result');

      // PB1: trigger review-cards generation (异步非阻塞)
      window.__TAURI__.core.invoke('generate_review_content', {
        projectPath: _projectPath,
        chapterFile: historyPayload.chapter || '',
        weakConcepts: historyPayload.result.weak_concepts || []
      }).catch(err => console.warn('[PB1] generate_review_content failed:', err));

      // PB2: init review schedule for this chapter's concepts
      window.__TAURI__.core.invoke('init_review_schedule', {
        projectPath: _projectPath,
        chapterFile: historyPayload.chapter || '',
        weakConcepts: historyPayload.result.weak_concepts || []
      }).catch(err => console.warn('[PB2] init_review_schedule failed:', err));

      // Sync in-memory state: Rust already wrote ch["status"]="completed" to
      // project.json, but ChapterStatusManager in the WebView doesn't know.
      // Promote the matching chapter to 'completed' so the onChapterStatusChange
      // hook in progress-tracker.js fires and sliding-window pre-generates the
      // next batch. ready → completed is a valid state-machine transition.
      //
      // Phase 1 (2026-06-17): gate by quiz rating. "struggling" means the
      // user didn't learn the chapter — sliding the window forward would
      // generate content the user isn't ready for. Skip the trigger and
      // surface a "需要重学本章" toast so the user knows to retake.
      //
      // chapter.file is now the FULL path (set in project-resume.js for
      // resumed projects), so we match by basename.
      if (window.LearningProgress && window.LearningProgress._manager) {
        const mgr = window.LearningProgress._manager;
        const basename = (p) => (p || '').split(/[/\\]/).pop();
        const fileName = basename(payload.chapterFile);
        const idx = mgr.chapters.findIndex(ch => basename(ch.file) === fileName);
        if (idx >= 0) {
          // Always persist the rating — even if already completed, the user
          // might have retaken the quiz with a different result.
          const prevRating = mgr.chapters[idx].rating;
          mgr.setRating(idx, payload.rating);

          if (mgr.chapters[idx].status === 'completed') {
            // Already completed — refresh rating badge in UI only.
            window.LearningProgress._ui?.updateChapter(idx);
            console.log('[QuizSaveHistory] chapter', idx, 'already completed, rating updated', prevRating, '→', payload.rating);
            // Retake scenario: previously struggling, now mastered/learning.
            // Status didn't change (completed→completed, no onChapterStatusChange
            // fired), so we must manually trigger the sliding window here.
            if (prevRating === 'struggling' && payload.rating !== 'struggling') {
              console.log('[QuizSaveHistory] retake struggling→' + payload.rating + ' → trigger sliding window');
              const triggerNext = window.LearningProgress && window.LearningProgress.triggerNextChapters;
              if (triggerNext) {
                triggerNext(_projectPath).catch(err =>
                  console.warn('[QuizSaveHistory] retake triggerNextChapters:', err)
                );
              }
            }
          } else {
            const rating = payload.rating;
            // Per state matrix (decisions.md 课程模式状态机):
            //   ready + 提交答题 → completed (any rating, including struggling)
            //   mastered/learning → 触发滑窗（下1章 n+2）
            //   struggling        → ❌ 不触发滑窗，但状态仍升级为 completed
            // Rust persist_quiz_result 已经无条件写了 completed，前端必须保持一致，
            // 否则会出现"关闭重开后 struggling 章节莫名变 completed"的不一致。
            try {
              mgr.setStatus(idx, 'completed');
              window.LearningProgress._ui?.updateChapter(idx);
              if (rating === 'struggling') {
                console.log('[QuizSaveHistory] chapter', idx, 'completed (rating=struggling) → skip sliding window, suggest retake');
                if (window.showToast) {
                  window.showToast('📚 本章掌握薄弱，建议重学后再继续', 'info');
                }
              } else {
                console.log('[QuizSaveHistory] marked chapter', idx, 'completed (rating=' + rating + ') → sliding window triggered');
              }
            } catch (e) {
              console.warn('[QuizSaveHistory] setStatus failed for chapter', idx, ':', e.message);
              window.LearningProgress._ui?.updateChapter(idx);
            }
          }
        } else {
          // Diagnostic: log why the lookup failed. Common cause is resumed
          // projects where chapter.file was null (fixed in project-resume.js).
          console.warn('[QuizSaveHistory] no chapter matched fileName=', fileName);
          console.log('[QuizSaveHistory] manager.chapters:');
          mgr.chapters.forEach((ch, i) => {
            console.log(`  [${i}] file=${JSON.stringify(ch.file)} status=${ch.status} title=${ch.title}`);
          });
        }
      }

      // Trigger Socratic review if threshold reached
      _maybeTriggerSocratic();
    } catch (err) {
      const msg = (err && err.message) || String(err);
      console.error('[QuizSaveHistory] persist failed:', msg);
      if (window.showToast) window.showToast('保存测验结果失败', 'error');
    }
  }

  // MVP: increment quiz count + check Socratic trigger
  async function _maybeTriggerSocratic() {
    if (!window.SocraticState || !window.SocraticTrigger) return;
    try {
      const state = await window.SocraticState.load(_projectPath);
      state.incrementQuizCount();
      await state.save(_projectPath);

      const result = await window.SocraticTrigger.checkAndTrigger({
        projectPath: _projectPath
      });

      if (result.shouldTrigger && result.toast) {
        _showSocraticToast(result.toast);
        if (window.TyporaNext && window.TyporaNext._updateSocraticButtonState) {
          window.TyporaNext._updateSocraticButtonState(true);
        }
      }
    } catch (e) {
      console.warn('[SocraticTrigger] check failed:', e);
    }
  }

  function _showSocraticToast(toast) {
    // Minimal toast UI (MVP)
    const existing = document.getElementById('socraticTriggerToast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'socraticTriggerToast';
    el.style.cssText = `
      position: fixed; top: 80px; right: 24px; width: 320px; padding: 14px 18px;
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid rgba(129,140,248,0.3); border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4); z-index: 9999;
      animation: slideUp 0.3s ease;
    `;
    el.innerHTML = `
      <div style="font-size:14px;font-weight:600;color:#f1f5f9;margin-bottom:8px;">🏛️ ${toast.text}</div>
      <div style="display:flex;gap:6px;">
        <button data-action="start" style="flex:1;padding:6px;border-radius:8px;font-size:12px;font-weight:600;background:linear-gradient(135deg,#818cf8,#a78bfa);color:white;border:none;cursor:pointer;">开始</button>
        <button data-action="postpone" style="flex:1;padding:6px;border-radius:8px;font-size:12px;background:rgba(255,255,255,0.04);color:#94a3b8;border:1px solid rgba(255,255,255,0.08);cursor:pointer;">稍后</button>
        <button data-action="optout" style="padding:6px 10px;border-radius:8px;font-size:12px;background:transparent;color:#64748b;border:none;cursor:pointer;">不再提醒</button>
      </div>
    `;
    document.body.appendChild(el);
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const state = await window.SocraticState.load(_projectPath);
        if (action === 'start') {
          const modal = new window.SocraticModal({ projectPath: _projectPath });
          await modal.open();
        } else if (action === 'postpone') {
          state.markDismissed();
          if (window.TyporaNext && window.TyporaNext._updateSocraticButtonState) {
            window.TyporaNext._updateSocraticButtonState(false);
          }
        } else if (action === 'optout') {
          state.markOptOut();
          if (window.TyporaNext && window.TyporaNext._updateSocraticButtonState) {
            window.TyporaNext._updateSocraticButtonState(false);
          }
        }
        await state.save(_projectPath);
        el.remove();
      });
    });
  }

  function showQuizToast(rating, score, weakList) {
    // Remove existing quiz toast
    const existing = document.getElementById('learningQuizToast');
    if (existing) existing.remove();

    const isMastered = rating === 'mastered';
    const isStruggling = rating === 'struggling';
    const color = isMastered ? '#10b981' : isStruggling ? '#ef4444' : '#f59e0b';
    const bg = isMastered ? '#ecfdf5' : isStruggling ? '#fef2f2' : '#fffbeb';
    const title = isMastered ? '完全掌握' : isStruggling ? '需要加强' : '基本理解';

    // SVG icons per rating
    const iconSvg = isMastered
      ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
        </svg>`
      : isStruggling
        ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>`
        : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>`;

    const weakTags = weakList.length
      ? weakList.map(w => `<span style="display: inline-block; padding: 2px 8px; background: white; border: 1px solid ${color}40; color: ${color}; border-radius: 999px; font-size: 11px; font-weight: 500;">${w}</span>`).join('')
      : '';

    const toast = document.createElement('div');
    toast.id = 'learningQuizToast';
    toast.style.cssText = `
      position: fixed;
      top: 24px; right: 24px;
      width: 320px;
      background: ${bg};
      border: 1px solid ${color}30;
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.15);
      z-index: 10003;
      animation: quizToastIn 0.35s ease-out;
    `;
    toast.innerHTML = `
      <style>
        @keyframes quizToastIn { from { opacity: 0; transform: translateY(16px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes quizToastOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(12px) scale(0.98); } }
      </style>
      <div style="display: flex; gap: 12px;">
        <div style="flex-shrink: 0;">${iconSvg}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="font-size: 15px; font-weight: 700; color: ${color};">${title}</div>
            <button id="quizToastClose" style="background: none; border: none; color: #9ca3af; font-size: 16px; cursor: pointer; padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">✕</button>
          </div>
          <div style="margin-top: 4px; font-size: 13px; color: #4b5563;">
            得分 <strong style="color: #111827;">${Math.round(score * 100)}%</strong>
          </div>
          ${weakTags ? `<div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 5px;">${weakTags}</div>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    const closeBtn = document.getElementById('quizToastClose');
    const remove = () => {
      toast.style.animation = 'quizToastOut 0.25s ease-in forwards';
      setTimeout(() => toast.remove(), 250);
    };
    if (closeBtn) closeBtn.addEventListener('click', remove);
    setTimeout(remove, 5000);
  }

  function onQuizAdaptRequested(adaptPayload) {
    // No-op: visual feedback moved into showQuizToast after submission
    if (!adaptPayload) return;
  }

  function closeQuizModal() {
    const existingDom = document.getElementById('learningQuizModal');
    if (existingDom) {
      console.warn('[QuizDebugClose] found existing modal in DOM, removing');
      existingDom.remove();
    }
    if (_quizModal) {
      _quizModal.remove();
      _quizModal = null;
    }
    // Render a collapsible result card in the chapter-end quiz area
    if (_lastQuizSubmission) {
      renderQuizResultCard(_lastQuizSubmission);
      _lastQuizSubmission = null;
    } else if (_quizPanel) {
      // User closed before submitting: reset so they can retake
      _quizPanel.reset();
    }
  }

  function renderQuizResultCard(submission) {
    console.log('[QuizDebugRender] rendering result card with', submission.answerRecords.length, 'records');
    const area = document.getElementById('learningQuizAreaBody');
    if (!area) return;

    const ratingText = submission.rating === 'mastered' ? '完全掌握'
      : submission.rating === 'learning' ? '基本理解' : '需要加强';
    const ratingColor = submission.rating === 'mastered' ? '#10b981'
      : submission.rating === 'learning' ? '#f59e0b' : '#ef4444';
    const ratingEmoji = submission.rating === 'mastered' ? '🟢'
      : submission.rating === 'learning' ? '🟡' : '🔴';

    let answerRows = '';
    submission.answerRecords.forEach((rec, idx) => {
      let statusText, statusColor, statusBg;
      if (rec.is_correct === true) { statusText = '正确'; statusColor = '#047857'; statusBg = '#d1fae5'; }
      else if (rec.is_correct === false) { statusText = '错误'; statusColor = '#b91c1c'; statusBg = '#fee2e2'; }
      else { statusText = '待定'; statusColor = '#b45309'; statusBg = '#fef3c7'; }

      let answerDisplay = '';
      if (rec.qtype === 'multiple' && Array.isArray(rec.user_answer)) {
        answerDisplay = rec.user_answer.join(', ') || '未作答';
      } else if (rec.user_answer !== null && rec.user_answer !== undefined && String(rec.user_answer).trim() !== '') {
        answerDisplay = String(rec.user_answer);
      } else {
        answerDisplay = '未作答';
      }

      const qtypeLabel = rec.qtype === 'single' ? '单选' : rec.qtype === 'multiple' ? '多选' : '开放';

      answerRows += `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 12px; color: #6b7280; font-weight: 500;">${idx + 1}</td>
          <td style="padding: 10px 12px; color: #374151;">${qtypeLabel}</td>
          <td style="padding: 10px 12px; color: #111827; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${answerDisplay}</td>
          <td style="padding: 10px 12px;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${statusBg}; color: ${statusColor};">${statusText}</span>
          </td>
        </tr>
      `;
    });

    const weakTags = submission.weakConcepts.length
      ? submission.weakConcepts.map(w => `<span style="display: inline-block; padding: 4px 10px; background: #fef2f2; color: #991b1b; border-radius: 999px; font-size: 12px; font-weight: 500;">${w}</span>`).join('')
      : '<span style="font-size: 13px; color: #6b7280;">无薄弱概念</span>';

    const nextHint = submission.rating === 'mastered'
      ? '<strong style="color: #047857;">恭喜！</strong> 本章已掌握，推荐进入下一章。'
      : submission.rating === 'learning'
        ? '<strong style="color: #b45309;">基本理解。</strong> 建议复习薄弱概念后继续。'
        : '<strong style="color: #b91c1c;">需要加强。</strong> 建议重新阅读本章后再测一次。';

    const card = document.createElement('div');
    card.id = 'learningQuizResultCard';
    card.style.cssText = `
      margin-top: 16px;
      background: white;
      border-radius: 14px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
      overflow: hidden;
    `;
    card.innerHTML = `
      <div id="quizResultHeader" style="padding: 16px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; background: linear-gradient(90deg, ${ratingColor}08, ${ratingColor}04);">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: ${ratingColor}15; color: ${ratingColor}; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700;">
            ${submission.rating === 'mastered' ? '✓' : submission.rating === 'learning' ? '◐' : '!'}
          </div>
          <div>
            <div style="font-size: 16px; font-weight: 700; color: ${ratingColor};">${ratingText}</div>
            <div style="font-size: 12px; color: #6b7280;">${submission.totalScored > 0 ? `得分 ${Math.round(submission.score * 100)}% · ${submission.correctCount}/${submission.totalScored} 题` : '开放题待评'} · 点击展开</div>
          </div>
        </div>
        <span id="quizResultToggle" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: white; border-radius: 6px; color: #6b7280; font-size: 12px; border: 1px solid #e5e7eb;">▶</span>
      </div>
      <div id="quizResultBody" style="display: none; padding: 18px 20px; border-top: 1px solid #f3f4f6;">
        <div style="overflow-x: auto; border: 1px solid #f3f4f6; border-radius: 10px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="background: #f9fafb; text-align: left;">
                <th style="padding: 10px 12px; color: #374151; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px;">题号</th>
                <th style="padding: 10px 12px; color: #374151; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px;">题型</th>
                <th style="padding: 10px 12px; color: #374151; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px;">你的答案</th>
                <th style="padding: 10px 12px; color: #374151; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px;">结果</th>
              </tr>
            </thead>
            <tbody>${answerRows}</tbody>
          </table>
        </div>
        <div style="margin-top: 14px; padding: 12px 14px; background: #f9fafb; border-radius: 8px;">
          <div style="font-size: 11px; font-weight: 700; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.3px;">薄弱概念</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">${weakTags}</div>
        </div>
        <div style="margin-top: 12px; font-size: 13px; color: #4b5563; line-height: 1.5;">${nextHint}</div>
        <div style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="quizRetakeBtn" style="padding: 8px 16px; background: white; color: #4f46e5; border: 1px solid #4f46e5; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">再测一次</button>
          <button id="extraReviewBtn" style="padding: 8px 16px; background: #f5f3ff; color: #7c3aed; border: 1px solid #c4b5fd; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; display: none;">📝 附加题回顾</button>
        </div>
      </div>
    `;

    // Replace previous result card if any
    const existing = document.getElementById('learningQuizResultCard');
    if (existing) existing.remove();

    area.appendChild(card);

    // Bind toggle
    const header = document.getElementById('quizResultHeader');
    const resultBody = document.getElementById('quizResultBody');
    const toggle = document.getElementById('quizResultToggle');
    if (header && resultBody && toggle) {
      header.addEventListener('click', () => {
        const isHidden = resultBody.style.display === 'none';
        resultBody.style.display = isHidden ? 'block' : 'none';
        toggle.textContent = isHidden ? '▼' : '▶';
      });
    }

    // Bind retake
    const retakeBtn = document.getElementById('quizRetakeBtn');
    if (retakeBtn && _quizPanel) {
      retakeBtn.addEventListener('click', () => {
        if (_quizPanel.getState() === 'graded') {
          _quizPanel.reset();
          _quizPanel.setQuestions(_currentQuizQuestions);
          _quizPanel.startAnswering();
        }
        onQuizStart();
      });
    }

    // Note: "附加题回顾" button is in the quiz area (injectQuizArea), not in the result card.
    // The quiz-area button visibility is managed by updateExtraReviewButton().
  }

  async function onQuizModalSubmit() {
    if (!_currentQuizQuestions.length) return;

    const body = document.getElementById('quizModalBody');
    console.log('[QuizDebugSubmit] questions count:', _currentQuizQuestions.length, 'body children:', body ? body.children.length : 0);

    let correctCount = 0;
    const weakConcepts = new Set();

    // Build answerRecords from _currentQuizQuestions (source of truth) instead of scanning DOM.
    // This prevents ghost records if DOM has stale/duplicate elements.
    const answerRecords = _currentQuizQuestions.map((q, idx) => {
      const el = body.querySelector(`[data-qid="${q.id}"]`);
      if (!el) {
        console.warn('[QuizDebugSubmit] missing DOM element for qid:', q.id);
        return {
          question_id: q.id,
          qtype: q.qtype || 'unknown',
          user_answer: null,
          is_correct: null
        };
      }

      let isCorrect = false;
      let userAnswer = null;

      if (q.qtype === 'single') {
        const selected = el.querySelector('input[type="radio"]:checked');
        userAnswer = selected ? selected.value : null;
        isCorrect = userAnswer === q.correct;
      } else if (q.qtype === 'multiple') {
        const selected = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
        userAnswer = selected;
        const correctSet = new Set(q.correct || []);
        const userSet = new Set(selected);
        isCorrect = correctSet.size === userSet.size && [...correctSet].every(v => userSet.has(v));
      } else if (q.qtype === 'short') {
        const textarea = el.querySelector('.quiz-short-answer');
        userAnswer = textarea ? textarea.value.trim() : '';
        isCorrect = null; // null = pending AI review
      } else {
        console.warn('[QuizDebugSubmit] unknown qtype for qid:', q.id, q.qtype);
        isCorrect = null;
      }

      if (isCorrect === true) {
        correctCount++;
        el.style.borderLeft = '4px solid #10b981';
        el.style.paddingLeft = '12px';
      } else if (isCorrect === false) {
        el.style.borderLeft = '4px solid #ef4444';
        el.style.paddingLeft = '12px';
        (q.weak_concepts || []).forEach(c => weakConcepts.add(c));
      } else {
        // short pending review (or unknown qtype)
        el.style.borderLeft = '4px solid #f59e0b';
        el.style.paddingLeft = '12px';
      }

      // Sync answer into QuizPanel so onSaveHistory gets real user answers
      if (_quizPanel) _quizPanel.setAnswer(q.id, userAnswer);

      return {
        question_id: q.id,
        qtype: q.qtype,
        user_answer: userAnswer,
        is_correct: isCorrect
      };
    });

    console.log('[QuizDebugSubmit] answerRecords:', JSON.stringify(answerRecords));

    const weakList = [...weakConcepts];
    console.log('[QuizDebugSubmit] weakList:', weakList);

    // Calculate rating (local scoring for single/multiple only)
    const scoredQuestions = _currentQuizQuestions.filter(q => q.qtype !== 'short');
    const score = scoredQuestions.length ? correctCount / scoredQuestions.length : 0;

    let rating, ratingText, ratingColor;
    if (score >= 0.8) {
      rating = 'mastered'; ratingText = '完全掌握'; ratingColor = '#10b981';
    } else if (score >= 0.5) {
      rating = 'learning'; ratingText = '基本理解'; ratingColor = '#f59e0b';
    } else {
      rating = 'struggling'; ratingText = '需要加强'; ratingColor = '#ef4444';
    }

    _lastQuizSubmission = {
      chapterFile: _quizPanel ? _quizPanel.getChapterFile() : '',
      rating,
      score,
      weakConcepts: weakList,
      answerRecords,
      correctCount,
      totalScored: scoredQuestions.length,
      timestamp: formatLocalTime()
    };

    // Update panel state (triggers onSaveHistory → persist)
    if (_quizPanel) {
      _quizPanel.submit(); // answering → submitting FIRST
      _quizPanel.setResult({ rating, score, weak_concepts: weakList, suggestions: [] }); // submitting → graded
    }

    // Hide footer completely (only keep toast)
    const footer = _quizModal.querySelector('div:last-child');
    if (footer) footer.style.display = 'none';

    // Show rating toast card instead of legacy toast
    showQuizToast(rating, score, weakList);
  }

  // ============================================
  // 3. Cornell Sidebar
  //    Replaces modal-based explain with 180px permanent sidebar + cue list
  // ============================================

  function setupSelectionExplainer() {
    console.log('setupSelectionExplainer');
    const inCourse = window.AppWorkspace?.isIn('course') ?? document.body.classList.contains('learning-mode');
    if (!inCourse) {
      console.log('not in course workspace, skip sidebar');
      return;
    }

    // Detect chapter change by file path (reliable for persistence)
    const chapterChanged = _currentChapterFile && _currentChapterFile !== _lastChapterFileForSidebar;
    if (chapterChanged) {
      console.log('chapter changed from', _lastChapterFileForSidebar, 'to', _currentChapterFile);
      teardownCornellSidebar();
      _lastChapterFileForSidebar = _currentChapterFile;
      initCornellSidebar();
      loadChapterExplanations();
    } else if (!_cornellSidebarEl) {
      initCornellSidebar();
      loadChapterExplanations();
    }

    // Update title from DOM for context display
    const md = document.getElementById('markdownBody');
    const newTitle = md ? (md.querySelector('h1, h2')?.textContent || '') : '';
    if (newTitle) _currentChapterTitle = newTitle;
    updateSidebarHeader();
  }

  function initCornellSidebar() {
    const sidebar = document.getElementById('cornellSidebar');
    if (!sidebar) { console.warn('cornellSidebar element not found'); return; }

    // 伴学记录整合后侧栏瘦身：cue 卡片列表撤掉（解释/举例/我有话说统一进伴学记录），
    // 只留章节信息 + 两个入口按钮
    _cornellSidebarEl = sidebar;
    sidebar.style.display = '';
    sidebar.innerHTML = `
      <div class="cornell-sidebar-header">
        <h4>本章要点</h4>
        <div class="info" id="cornellSidebarInfo">📖 本章</div>
        <div class="meta" id="cornellSidebarMeta">还没有要点</div>
      </div>
      <div class="cornell-sidebar-actions">
        <button class="cornell-footer-btn cornell-footer-btn-primary" id="ownVoiceBtn">💬 我有话说</button>
        <button class="cornell-footer-btn" id="companionHistoryBtn">🕘 伴学记录</button>
      </div>
      <div class="cornell-sidebar-footer" id="cornellSidebarFooter">✨ 划词伴学 · 或直接「我有话说」</div>
    `;

    // 「我有话说」不划词直达 AI 伴学面板（自由发言入口）
    const ownVoiceBtn = document.getElementById('ownVoiceBtn');
    if (ownVoiceBtn) {
      ownVoiceBtn.addEventListener('click', () => {
        openAICompanion('', 'talk');
      });
    }

    // 伴学记录入口：统一历史列表（💡 解释 + 📋 举例 + 💬 我有话说），点击续聊
    const companionHistoryBtn = document.getElementById('companionHistoryBtn');
    if (companionHistoryBtn) {
      companionHistoryBtn.addEventListener('click', () => {
        openCompanionHistory();
      });
    }

    // Read current chapter title
    const md = document.getElementById('markdownBody');
    _currentChapterTitle = md ? (md.querySelector('h1, h2')?.textContent || '') : '';
    updateSidebarHeader();
  }

  function updateSidebarHeader() {
    const info = document.getElementById('cornellSidebarInfo');
    const meta = document.getElementById('cornellSidebarMeta');
    if (!info || !meta) return;

    const chapter = _currentChapterTitle || '本章';
    info.textContent = '📖 ' + chapter;

    const count = _cornellCues.length;
    if (count === 0) {
      meta.textContent = '还没有要点';
    } else if (count === 1) {
      meta.textContent = '1 条要点';
    } else {
      meta.textContent = count + ' 条要点';
    }
  }

  /**
   * 正文波浪线 marks 的统一接线：hover 显示问答摘要，
   * 点击打开该解释的续聊面板（cue 卡片已并入伴学记录）。
   */
  function attachCueMarks() {
    const mdPane = document.getElementById('markdownBody');
    if (!mdPane || !window.CornellTextMarks) return;
    window.CornellTextMarks.attachMarkInteractions(mdPane, {
      getCue: (id) => _cornellCues.find(c => c.id === id),
      onCueClick: (cueId) => {
        const cue = _cornellCues.find(c => c.id === cueId);
        if (!cue) return;
        // chapter 用章节 basename：解释落盘按 {chapter_stem}/{cue_id}.json
        const conversation = cueToConversation(cue);
        conversation.chapter = getChapterBasename(_currentChapterFile);
        openAICompanion(cue.term, 'explain', {
          record: {
            selected_text: cue.term,
            chapter_file: _currentChapterFile,
            explain: conversation
          }
        });
      }
    });
  }

  /** 内部数据结构 → 持久化契约（ExplanationConversation） */
  function cueToConversation(cue) {
    return {
      id: cue.id,
      selected_text: cue.term,
      anchor: null,
      qa_history: cue.qaHistory.map(h => ({
        q: h.q,
        a: h.a,
        ts: h.ts || new Date().toISOString()
      })),
      created_at: cue.createdAt || new Date().toISOString()
    };
  }

  // ============================================
  // Persistence
  // ============================================

  async function loadChapterExplanations() {
    if (!_projectPath || !_currentChapterFile) return;
    // Snapshot for the race guard: the await below may resolve after the
    // user already switched chapters — never inject stale marks then.
    const chapterAtCall = _currentChapterFile;
    try {
      const data = await window.__TAURI__.core.invoke('load_chapter_explanations', {
        projectPath: _projectPath,
        chapter: getChapterBasename(_currentChapterFile)
      });
      if (!data || !data.conversations || !data.conversations.length) return;

      clearCues();

      let maxIdNum = 0;
      data.conversations.forEach(conv => {
        _cornellCues.push({
          id: conv.id,
          term: conv.selected_text,
          qaHistory: conv.qa_history.map(h => ({ q: h.q, a: h.a, ts: h.ts })),
          createdAt: conv.created_at
        });

        const match = conv.id.match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxIdNum) maxIdNum = num;
        }
      });
      _cornellCueIdCounter = maxIdNum;
      updateSidebarHeader();
      updateExtraReviewButton();

      // 划词痕迹：注入正文 marks（竞态守卫：await 期间切章则放弃）
      if (chapterAtCall === _currentChapterFile && window.CornellTextMarks) {
        const mdPaneLoad = document.getElementById('markdownBody');
        if (mdPaneLoad) {
          attachCueMarks();
          window.CornellTextMarks.injectAllCueMarks(mdPaneLoad, _cornellCues);
        }
      }
    } catch (err) {
      console.warn('loadChapterExplanations failed:', err);
    }
  }

  async function persistCue(cue) {
    if (!_projectPath || !_currentChapterFile) return;
    try {
      await window.__TAURI__.core.invoke('persist_explanation', {
        projectPath: _projectPath,
        chapter: getChapterBasename(_currentChapterFile),
        conversation: cueToConversation(cue)
      });
      updateExtraReviewButton();
    } catch (err) {
      console.warn('persistCue failed:', err);
    }
  }


  /** 清空本章 cue 数据（伴学记录整合后无卡片 DOM 可重置，只管数据与计数） */
  function clearCues() {
    _cornellCues = [];
    _cornellCueIdCounter = 0;
    updateSidebarHeader();
  }

  function teardownCornellSidebar() {
    // 划词痕迹：退出课程模式（不重渲染正文）时清理 marks；
    // 切章节时 innerHTML 重建，marks 本就自然消亡，这里多调一次无害
    const mdPaneTd = document.getElementById('markdownBody');
    if (mdPaneTd && window.CornellTextMarks) {
      window.CornellTextMarks.removeAllCueMarks(mdPaneTd);
    }

    const sidebar = document.getElementById('cornellSidebar');
    if (sidebar) {
      sidebar.style.display = 'none';
      sidebar.innerHTML = '';
    }
    _cornellSidebarEl = null;
    _cornellCues = [];
    _cornellCueIdCounter = 0;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Legacy modal fallback (kept for reference, no longer used by new flow)
  function showExplanationModal(title, body) {
    const existing = document.getElementById('learningExplanationModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'learningExplanationModal';
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;
    modal.innerHTML = `
      <div style="
        background: white;
        padding: 24px;
        border-radius: 8px;
        max-width: 500px;
        width: 90%;
        max-height: 70vh;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      ">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #4f46e5;">
          ${title}
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: #1f2937;">
          ${body || '<span style="color: #9ca3af;">加载中...</span>'}
        </div>
        <button id="learningExplanationClose" style="
          margin-top: 16px;
          padding: 8px 16px;
          background: #e5e7eb;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        ">关闭</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('learningExplanationClose').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // ============================================
  // 4. Daily Review (遗忘曲线提醒)
  // ============================================

  function showReviewModal(projectPath, items, cards) {
    if (!window.ReviewModal) {
      console.warn('ReviewModal not loaded');
      return;
    }
    if (_reviewModal && _reviewModal.getState() !== 'hidden') return;

    const scheduler = new window.ReviewScheduler();
    _reviewModal = new window.ReviewModal({
      items,
      cards,
      onComplete: async (answers) => {
        const beforeStatus = {};
        for (const item of items) {
          beforeStatus[item.concept] = item.status || 'due';
        }

        for (const ans of answers) {
          await scheduler.submitReviewResult(projectPath, ans.concept, ans.rating, ans.answers || []);
        }
        _reviewModal = null;

        showReviewSummary(projectPath, items, answers, beforeStatus);
      },
      onPostpone: async () => {
        for (const item of items) {
          await scheduler.syncPostpone(projectPath, item.concept);
        }
        _reviewModal = null;
      }
    });
    _reviewModal.show();
  }

  async function checkDailyReview(projectPath) {
    if (!window.ReviewScheduler || !window.ReviewModal) {
      console.warn('ReviewScheduler or ReviewModal not loaded');
      return;
    }
    if (_reviewModal && _reviewModal.getState() !== 'hidden') return;

    try {
      const scheduler = new window.ReviewScheduler();
      const items = await scheduler.getDueItems(projectPath);

      if (!items || items.length === 0) return;

      const cards = await scheduler.getReviewCards(projectPath);
      showReviewModal(projectPath, items, cards);
    } catch (err) {
      console.error('checkDailyReview error:', err);
    }
  }

  // ============================================
  // PB5: Missing Review Cards Recovery (legacy: scans completed chapters)
  // ============================================

  async function checkMissingReviewCards(projectPath) {
    if (!projectPath || !window.__TAURI__) return;
    try {
      const missing = await window.__TAURI__.core.invoke('check_missing_review_cards', { projectPath });
      if (!missing || missing.length === 0) return;

      console.log('[PB5] missing review cards found:', missing);
      for (const chapter of missing) {
        const chFile = chapter.chapter_file || '';
        const weakConcepts = chapter.missing_concepts || [];
        try {
          await window.__TAURI__.core.invoke('generate_review_content', {
            projectPath,
            chapterFile: chFile,
            weakConcepts
          });
          console.log('[PB5] auto-regenerate completed for', chFile);
        } catch (err) {
          console.warn('[PB5] auto-regenerate failed for', chFile, err);
        }
      }
    } catch (err) {
      console.warn('[PB5] checkMissingReviewCards error:', err);
    }
  }

  /**
   * Show a full-screen loading overlay while review cards are being generated.
   */
  function showReviewLoading(message) {
    hideReviewLoading();
    const overlay = document.createElement('div');
    overlay.id = 'reviewLoadingOverlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10010;
      flex-direction: column;
      gap: 16px;
    `;
    overlay.innerHTML = `
      <div style="width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.2); border-top-color: #f59e0b; border-radius: 50%; animation: review-spin 1s linear infinite;"></div>
      <div style="color: white; font-size: 15px; font-weight: 500;">${message || '正在准备复习卡片...'}</div>
      <style>
        @keyframes review-spin { to { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(overlay);
    _reviewLoadingEl = overlay;
  }

  function hideReviewLoading() {
    if (_reviewLoadingEl) {
      _reviewLoadingEl.remove();
      _reviewLoadingEl = null;
    }
  }

  /**
   * Unified entry for daily review: only generate cards for concepts that are due
   * today and missing review cards. Batch-generate them in one agent call, then
   * show the review modal. Used from the project dashboard review entry.
   */
  async function checkAndShowDailyReview(projectPath) {
    if (!projectPath || !window.__TAURI__ || !window.ReviewScheduler || !window.ReviewModal) {
      console.warn('[ReviewEntry] prerequisites not ready');
      return;
    }
    if (_reviewModal && _reviewModal.getState() !== 'hidden') return;
    if (_reviewCheckInProgress) {
      console.log('[ReviewEntry] already checking, skip duplicate');
      return;
    }

    try {
      _reviewCheckInProgress = true;
      showReviewLoading('正在准备复习卡片...');

      const scheduler = new window.ReviewScheduler();
      const items = await scheduler.getDueItems(projectPath);
      if (!items || items.length === 0) {
        hideReviewLoading();
        return;
      }

      const cards = await scheduler.getReviewCards(projectPath);

      const missingConcepts = items
        .filter(item => !cards[item.concept])
        .map(item => ({
          id: item.concept,
          name: item.concept,
          source_chapter: item.source_chapter || '',
          weak: true
        }));

      if (missingConcepts.length > 0) {
        showReviewLoading(`正在为 ${missingConcepts.length} 个概念生成复习卡片...`);
        console.log('[ReviewEntry] batch generating cards for', missingConcepts.length, 'due concepts');
        await window.__TAURI__.core.invoke('generate_review_content_batch', {
          projectPath,
          concepts: missingConcepts
        });
      }

      const updatedCards = await scheduler.getReviewCards(projectPath);
      hideReviewLoading();
      showReviewModal(projectPath, items, updatedCards);
    } catch (err) {
      console.error('[ReviewEntry] checkAndShowDailyReview error:', err);
      hideReviewLoading();
      if (window.showToast) {
        window.showToast('准备复习卡片失败，请重试', 'error');
      }
    } finally {
      _reviewCheckInProgress = false;
    }
  }

  // ============================================
  // 5. Review Summary Modal (知识图谱)
  // ============================================

  async function showReviewSummary(projectPath, items, answers, beforeStatus) {
    if (!window.ReviewSummaryModal || !window.KnowledgeGraphManager) return;

    try {
      // Build changes array
      const changes = answers.map(ans => ({
        concept: ans.concept,
        fromStatus: beforeStatus[ans.concept] || 'not_started',
        toStatus: ans.rating,
        chapter: items.find(i => i.concept === ans.concept)?.source_chapter || ''
      }));

      // Load mini graph for the summary modal
      const kgm = new window.KnowledgeGraphManager(projectPath);
      const graph = await kgm.loadGraph();

      // Show modal
      const modal = new window.ReviewSummaryModal({
        onViewFullGraph: () => {
          modal.close();
          // Re-show full dashboard
          if (window.LearningProjectResume && window.LearningProjectResume.showDashboard) {
            window.LearningProjectResume.showDashboard(projectPath);
          }
        }
      });

      modal.show({
        reviewResult: { changes, reviewedCount: answers.length, totalCount: items.length },
        miniGraph: graph
      });
    } catch (e) {
      console.warn('showReviewSummary error:', e);
    }
  }

  // ============================================
  // Case Study（案例研习）
  // ============================================

  // ============================================
  // AI 伴学统一面板（解释 / 举例 / 我有话说，入口统一）
  // ============================================

  /**
   * 打开 AI 伴学统一面板。
   * @param {string} term - 划词概念；空 = 自由发言（不划词）
   * @param {string} mode - 'explain' | 'example' | 'talk'
   * @param {object} [opts] - 续聊入口
   * @param {object} [opts.record] - 一条伴学记录（一个起点的全部模式部分）
   */
  async function openAICompanion(term, mode, opts) {
    if (!window.AICompanionModal) {
      console.warn('AICompanionModal not loaded');
      return;
    }

    // 章节上下文：划词进面板时取当前正文的章节目标与所在段落
    let chapterGoal = '';
    const md = document.getElementById('markdownBody');
    if (md) {
      const callout = md.querySelector('blockquote[data-enhanced]');
      if (callout) chapterGoal = callout.textContent.trim().substring(0, 200);
    }
    let surroundingText = '';
    const sel = window.getSelection();
    if (term && sel && sel.rangeCount > 0 && sel.toString().trim()) {
      let node = sel.getRangeAt(0).startContainer;
      while (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const blockEl = node?.closest?.('p, h1, h2, h3, h4, li, td, blockquote') || node;
      if (blockEl) surroundingText = blockEl.textContent.trim().substring(0, 400);
    }

    const modal = new window.AICompanionModal({
      projectPath: _projectPath,
      selectedText: term || '',
      context: {
        chapterTitle: _currentChapterTitle,
        chapterGoal,
        surroundingText
      },
      chapterFile: _currentChapterFile,
      initialMode: mode || 'talk',
      record: (opts && opts.record) || null
    });
    await modal.open();
  }

  /**
   * 伴学记录：一条记录 = 一个起点（💡/📋/💬/🖼️ 四种模式归并，新→旧）。
   * 点击续聊：带整条记录进伴学面板，四种模式都能接着聊。
   */
  async function openCompanionHistory() {
    if (!window.__TAURI__) return;
    let caseSessions = [];
    let talkSessions = [];
    let visualizeSessions = [];
    let explanations = [];
    try {
      caseSessions = await window.__TAURI__.core.invoke('case_study_list_sessions', { projectPath: _projectPath }) || [];
    } catch (e) { console.warn('case_study_list_sessions failed:', e); }
    try {
      talkSessions = await window.__TAURI__.core.invoke('own_voice_list_sessions', { projectPath: _projectPath }) || [];
    } catch (e) { console.warn('own_voice_list_sessions failed:', e); }
    try {
      visualizeSessions = await window.__TAURI__.core.invoke('visualize_list_sessions', { projectPath: _projectPath }) || [];
    } catch (e) { console.warn('visualize_list_sessions failed:', e); }
    try {
      explanations = await window.__TAURI__.core.invoke('list_project_explanations', { projectPath: _projectPath }) || [];
    } catch (e) { console.warn('list_project_explanations failed:', e); }

    const MODES = window.CompanionCore.MODES;
    const fmtDate = (ts, withTime) => {
      const d = new Date(ts);
      if (!ts || isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      const md = (d.getMonth() + 1) + '-' + d.getDate();
      return withTime ? md + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : md;
    };

    // 一条记录 = 一个起点（归并规则见 CompanionCore.buildRecords）
    const items = window.CompanionCore.buildRecords({
      explanations: explanations,
      caseSessions: caseSessions,
      talkSessions: talkSessions,
      visualizeSessions: visualizeSessions
    });

    if (items.length === 0) {
      if (window.showToast) window.showToast('还没有伴学记录，划词伴学或直接「我有话说」吧', 'info');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'socratic-modal-overlay';
    overlay.id = 'companionHistoryOverlay';

    const card = document.createElement('div');
    card.className = 'socratic-modal-card';
    card.innerHTML = `
      <div class="socratic-modal-header">
        <div class="socratic-modal-header-top">
          <div class="socratic-modal-header-left">
            <div class="socratic-modal-icon">🕘</div>
            <div>
              <div class="socratic-modal-title">伴学记录</div>
              <div class="socratic-modal-subtitle">${items.length} 个起点 · 点击继续对话</div>
            </div>
          </div>
          <button id="companionHistoryCloseBtn" class="socratic-modal-end-btn">关闭</button>
        </div>
      </div>
    `;

    const list = document.createElement('div');
    list.className = 'casestudy-history-list';
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'casestudy-history-item';
      const meta = [item.rounds + ' 轮', item.chapter, item.modes].filter(Boolean).join(' · ');
      el.innerHTML = `
        <div class="casestudy-history-concept"><span class="companion-history-kind">${MODES[item.primary].icon}</span>${escapeHtml(item.title)}</div>
        <div class="casestudy-history-meta">${escapeHtml(meta)} · ${fmtDate(item.sortKey, item.global)}</div>
      `;
      el.addEventListener('click', () => {
        overlay.remove();
        openAICompanion(item.record.selected_text, item.primary, { record: item.record });
      });
      list.appendChild(el);
    }
    card.appendChild(list);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    card.querySelector('#companionHistoryCloseBtn').addEventListener('click', () => overlay.remove());
  }

  /**
   * AI 伴学面板的解释轮次落痕：按 term 找已有 cue 追加，没有则新建。
   * 面板是对话现场，cue 是留痕（正文波浪线锚点 + 解释记录落盘），
   * 不再发起 LLM 调用——解释内容已由面板取得。无划词（term 空）不落痕。
   */
  function syncCompanionCue(info) {
    const term = info && info.term;
    if (!term) return;
    const question = info.question || term;
    const answer = info.answer || '';

    let cue = _cornellCues.find(c => c.term === term);
    if (!cue) {
      cue = {
        id: 'cue-' + (++_cornellCueIdCounter),
        term: term,
        qaHistory: [],
        createdAt: new Date().toISOString()
      };
      _cornellCues.push(cue);
    }
    cue.qaHistory.push({ q: question, a: answer, ts: new Date().toISOString() });
    updateSidebarHeader();

    const mdPane = document.getElementById('markdownBody');
    if (mdPane && window.CornellTextMarks) {
      attachCueMarks();
      window.CornellTextMarks.injectCueMark(mdPane, { id: cue.id, term: cue.term });
    }
    persistCue(cue);
  }

  // ============================================
  // Public API
  // ============================================

  window.LearningModeIntegration = {
    enhanceLearningElements,
    setupQuizPanel,
    setupSelectionExplainer,
    checkDailyReview,
    checkMissingReviewCards,
    checkAndShowDailyReview,
    clearCues,
    openAICompanion,
    openCompanionHistory,
    syncCompanionCue,
    getProjectPath() { return _projectPath; },
    teardown() {
      if (_quizAreaEl) { _quizAreaEl.remove(); _quizAreaEl = null; }
      closeQuizModal();
      hideReviewLoading();
      // Hide AI companion button when exiting learning mode
      const aiBtn = document.getElementById('aiCompanionBtn');
      if (aiBtn) aiBtn.style.display = 'none';
      const companionMenu = document.getElementById('companionMenu');
      if (companionMenu) companionMenu.style.display = 'none';
      _quizPanel = null;
      _selectionExplainer = null;
      _scrollListenerBound = false;
      _currentQuizQuestions = [];
      if (_reviewModal) { _reviewModal.teardown(); _reviewModal = null; }
      teardownCornellSidebar();
      _lastChapterFileForSidebar = '';
    }
  };
})();
