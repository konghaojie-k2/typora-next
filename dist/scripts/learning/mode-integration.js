/**
 * Learning Mode UI Integration
 * Connects QuizPanel + SelectionExplainer to the main UI
 *
 * Sprint 3 UI integration layer
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
    console.log('[Sprint3] enhanceLearningElements called');
    if (!document.body.classList.contains('learning-mode')) { console.log('[Sprint3] not in learning-mode, skip'); return; }

    const md = document.getElementById('markdownBody');
    if (!md) return;

    const allBlockquotes = md.querySelectorAll('blockquote:not([data-sprint3-enhanced])');
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
      bq.dataset.sprint3Enhanced = 'true';
      bq.dataset.sprint3Type = type;

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

    console.log('[Sprint3] enhanced', enhanced, 'callout blocks');
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
    console.log('[Sprint3] setupQuizPanel called, chapterFile:', chapterFile, 'projectPath:', projectPath);
    if (!window.QuizPanel) { console.warn('[Sprint3] QuizPanel not loaded'); return; }
    if (!document.body.classList.contains('learning-mode')) { console.log('[Sprint3] not in learning-mode, skip quiz'); return; }

    _projectPath = projectPath || '';
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
        <button class="quiz-area-start-btn" id="learningQuizStartBtn" style="
          padding: 10px 20px;
          background: #4f46e5;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
        ">开始测验</button>
      </div>
    `;
    md.appendChild(_quizAreaEl);

    // Bind start button
    const startBtn = document.getElementById('learningQuizStartBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => onQuizStart());
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
      console.log('[Sprint3] scroll progress:', Math.round(progress * 100) + '%');
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
      console.log('[QuizDebug] chapterFile=', chapterFile);
      const questions = await window.__TAURI__.core.invoke('generate_chapter_quiz', { chapterFile });
      console.log('[QuizDebug] loaded questions:', questions.length);
      _currentQuizQuestions = questions;
      if (_quizPanel) _quizPanel.setQuestions(questions);
      _quizPanel.startAnswering();
      console.log('[QuizDebug] showing modal...');
      showQuizModal(questions);
    } catch (err) {
      console.error('[QuizDebug] onQuizStart error:', err);
      const msg = (err && err.message) || String(err);
      if (window.showToast) window.showToast('❌ 加载测验失败: ' + msg, 'error');
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
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #f3f4f6; border-radius: 6px; color: #4f46e5; font-size: 13px; margin-right: 8px;">${idx + 1}</span>
          ${q.question}
          ${q.qtype === 'multiple' ? '<span style="font-size: 12px; color: #9ca3af; font-weight: 500; margin-left: 6px;">多选</span>' : ''}
        </div>
        <div class="quiz-options">${optionsHtml}</div>
      `;
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
    } catch (err) {
      const msg = (err && err.message) || String(err);
      console.error('[QuizSaveHistory] persist failed:', msg);
      if (window.showToast) window.showToast('保存测验结果失败', 'error');
    }
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
      bottom: 24px; right: 24px;
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
        <div style="margin-top: 14px;">
          <button id="quizRetakeBtn" style="padding: 8px 16px; background: white; color: #4f46e5; border: 1px solid #4f46e5; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">再测一次</button>
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
  // 3. Selection Explainer: floating toolbar
  // ============================================

  function setupSelectionExplainer() {
    console.log('[Sprint3] setupSelectionExplainer called');
    if (!window.SelectionExplainer) { console.warn('[Sprint3] SelectionExplainer not loaded'); return; }
    if (!document.body.classList.contains('learning-mode')) { console.log('[Sprint3] not in learning-mode, skip selection'); return; }

    _selectionExplainer = new window.SelectionExplainer();

    // Show the AI explain button in the existing selection toolbar
    const aiBtn = document.getElementById('aiExplainBtn');
    if (aiBtn) {
      aiBtn.style.display = '';
      aiBtn.addEventListener('click', onAiExplainClick);
    }
  }

  async function onAiExplainClick() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 2) return;

    // Hide the selection toolbar
    const aiBtn = document.getElementById('aiExplainBtn');
    if (aiBtn) aiBtn.style.display = 'none';

    // Read chapter context
    const md = document.getElementById('markdownBody');
    const context = md ? md.querySelector('h1, h2')?.textContent || '' : '';

    showExplanationModal('🤔 AI 正在解释...', '');

    try {
      const explanation = await window.__TAURI__.core.invoke('explain_selection', { text, context });
      showExplanationModal('📖 AI 解释', explanation);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      showExplanationModal('❌ 解释失败', `${msg}<br><small>Sprint 3 决策：Agent 失败显式报错</small>`);
    }

    // Re-show the button for next selection
    if (aiBtn) aiBtn.style.display = '';
  }

  function showExplanationModal(title, body) {
    // Remove existing modal
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
  // Public API
  // ============================================

  window.LearningModeIntegration = {
    enhanceLearningElements,
    setupQuizPanel,
    setupSelectionExplainer,
    teardown() {
      if (_quizAreaEl) { _quizAreaEl.remove(); _quizAreaEl = null; }
      closeQuizModal();
      // Hide AI explain button when exiting learning mode
      const aiBtn = document.getElementById('aiExplainBtn');
      if (aiBtn) aiBtn.style.display = 'none';
      _quizPanel = null;
      _selectionExplainer = null;
      _scrollListenerBound = false;
      _currentQuizQuestions = [];
    }
  };
})();
