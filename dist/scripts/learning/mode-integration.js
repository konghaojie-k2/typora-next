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
  let _selectionToolbarEl = null;
  let _quizAreaEl = null;
  let _scrollListenerBound = false;
  let _selectionListenerBound = false;

  // ============================================
  // 1. Enhance Learning Elements (callouts → cards)
  // ============================================

  /**
   * Scan markdownBody for GitHub Alert callouts and replace with interactive cards
   * Triggered after each renderMarkdown() call
   */
  function enhanceLearningElements() {
    if (!window.ElementRenderer) return;
    if (!document.body.classList.contains('learning-mode')) return;

    const md = document.getElementById('markdownBody');
    if (!md) return;

    const renderer = new window.ElementRenderer.ElementRenderer();
    const callouts = md.querySelectorAll('blockquote.markdown-alert, blockquote[data-callout-type]');

    callouts.forEach(callout => {
      // Detect type from data-callout-type or class
      let type = callout.dataset.calloutType;
      if (!type) {
        const m = (callout.className || '').match(/markdown-alert-(\w+)/);
        if (m) type = m[1];
      }
      if (!type || !['concept', 'question', 'quiz'].includes(type)) return;

      // Extract title from first paragraph (e.g., "注意力机制")
      const titleEl = callout.querySelector('p:first-child strong, p:first-child');
      const title = titleEl ? titleEl.textContent.trim() : '';

      // Extract body (all paragraphs except first)
      const paragraphs = Array.from(callout.querySelectorAll('p'));
      const body = paragraphs.slice(1).map(p => p.textContent).join('\n');

      // Extract options for quiz
      let options = [];
      if (type === 'quiz') {
        // Look for list items
        const items = callout.querySelectorAll('li');
        items.forEach((li, i) => {
          const text = li.textContent.trim();
          const labelMatch = text.match(/^([A-Z])\.\s*(.+?)(?:\s*✓)?$/);
          if (labelMatch) {
            options.push({
              label: labelMatch[1],
              text: labelMatch[2].trim(),
              correct: text.includes('✓')
            });
          }
        });
        if (!options.length) {
          // Fallback: detect options from first paragraph
          const firstP = paragraphs[0];
          if (firstP) {
            const text = firstP.textContent;
            // Pattern: "1. Question? A. opt1 B. opt2 ✓ C. opt3"
            const optMatches = text.matchAll(/([A-Z])\.\s*([^A-Z]+?)(?=\s*[A-Z]\.\s|$)/g);
            for (const m of optMatches) {
              options.push({
                label: m[1],
                text: m[2].trim().replace(/✓$/, '').trim(),
                correct: m[2].includes('✓')
              });
            }
          }
        }
      }

      // Render card
      let cardHtml = '';
      if (type === 'concept') {
        cardHtml = renderer.renderConceptCard({ title, body });
      } else if (type === 'question') {
        // Try to extract answer (last paragraph if starts with "答" or contains "解释")
        let answer = '';
        for (let i = paragraphs.length - 1; i >= 1; i--) {
          const t = paragraphs[i].textContent;
          if (t.includes('答') || t.includes('解释') || t.includes('因为')) {
            answer = t;
            break;
          }
        }
        cardHtml = renderer.renderQuestionCard({ title, question: body, answer });
      } else if (type === 'quiz') {
        const firstP = paragraphs[0];
        const questionText = firstP ? firstP.textContent.replace(/^\d+\.\s*/, '').trim() : body;
        cardHtml = renderer.renderQuizCard({ question: questionText, options });
      }

      if (cardHtml) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = cardHtml;
        callout.replaceWith(wrapper.firstElementChild);
      }
    });
  }

  // ============================================
  // 2. Quiz Panel: "掌握了吗？" area + scroll trigger
  // ============================================

  function setupQuizPanel(chapterFile) {
    if (!window.QuizPanel) return;
    if (!document.body.classList.contains('learning-mode')) return;

    _quizPanel = new window.QuizPanel.QuizPanel({ chapterFile: chapterFile || 'unknown' });
    injectQuizArea();
    bindScrollListener();
  }

  function injectQuizArea() {
    if (_quizAreaEl) return;
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
    window.addEventListener('scroll', () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? window.scrollY / docHeight : 0;
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
  }

  async function onQuizStart() {
    const body = document.getElementById('learningQuizAreaBody');
    if (!body) return;

    body.innerHTML = '<div style="color: #6b7280;">AI 正在生成测验题...</div>';
    if (_quizPanel) _quizPanel.startAnswering();

    try {
      // Read chapter file path from app state
      const chapterFile = _quizPanel.getChapterFile();
      const questions = await window.__TAURI__.core.invoke('generate_chapter_quiz', { chapterFile });
      if (_quizPanel) _quizPanel.setQuestions(questions);

      // Render questions
      const renderer = new window.ElementRenderer.ElementRenderer();
      const html = questions.map((q, i) => {
        const card = renderer.renderQuizCard({
          question: q.question,
          options: q.options,
          multiple: q.qtype === 'multiple'
        });
        return `<div style="margin: 16px 0;">${card}</div>`;
      }).join('');
      body.innerHTML = html + `
        <button class="quiz-submit-btn" id="learningQuizSubmitBtn" style="
          margin-top: 16px;
          padding: 10px 20px;
          background: #4f46e5;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
        ">提交答案</button>
      `;
      document.getElementById('learningQuizSubmitBtn').addEventListener('click', onQuizSubmit);
    } catch (err) {
      body.innerHTML = `<div style="color: #dc2626;">❌ 生成失败: ${err.message}<br><small>Sprint 3 决策：Agent 失败不静默降级，请检查 Agent SDK</small></div>`;
    }
  }

  async function onQuizSubmit() {
    if (!_quizPanel) return;
    _quizPanel.submit();

    // Collect answers
    const body = document.getElementById('learningQuizAreaBody');
    const cards = body.querySelectorAll('.learning-quiz');
    const answers = {};
    cards.forEach(card => {
      const selected = Array.from(card.querySelectorAll('.quiz-option')).filter(
        o => o.querySelector('input')?.checked
      );
      selected.forEach(s => {
        const label = s.dataset.label;
        answers[card.querySelector('.quiz-question').textContent] = label;
      });
    });

    try {
      const result = await window.__TAURI__.core.invoke('evaluate_quiz', {
        chapter: _quizPanel.getChapterFile(),
        questions: _quizPanel.getQuestions(),
        answers
      });

      _quizPanel.setResult(result);

      const ratingMap = {
        mastered: { emoji: '🟢', text: '完全掌握', color: '#10b981' },
        learning: { emoji: '🟡', text: '基本理解', color: '#f59e0b' },
        struggling: { emoji: '🔴', text: '需要加强', color: '#ef4444' }
      };
      const r = ratingMap[result.rating] || ratingMap.learning;

      body.innerHTML = `
        <div class="quiz-result" style="
          padding: 20px;
          background: ${r.color}20;
          border-left: 4px solid ${r.color};
          border-radius: 6px;
          margin-top: 16px;
        ">
          <div style="font-size: 18px; font-weight: 600; color: ${r.color};">
            ${r.emoji} ${r.text}
          </div>
          ${result.weak_concepts && result.weak_concepts.length ? `
            <div style="margin-top: 12px; color: #6b7280;">
              <strong>薄弱概念：</strong>${result.weak_concepts.join('、')}
            </div>
          ` : ''}
          ${result.suggestions && result.suggestions.length ? `
            <div style="margin-top: 8px; color: #6b7280;">
              <strong>建议：</strong>${result.suggestions.join('；')}
            </div>
          ` : ''}
        </div>
      `;

      // Toast for adaptive feedback (Sprint 3 decision)
      if (result.rating !== 'mastered' && window.showToast) {
        window.showToast(`📚 AI 已根据你的测验结果调整后续章节（${r.text}）`, 'info');
      }
    } catch (err) {
      body.innerHTML = `<div style="color: #dc2626;">❌ 评估失败: ${err.message}<br><small>Sprint 3 决策：评估失败显式报错</small></div>`;
    }
  }

  // ============================================
  // 3. Selection Explainer: floating toolbar
  // ============================================

  function setupSelectionExplainer() {
    if (!window.SelectionExplainer) return;
    if (!document.body.classList.contains('learning-mode')) return;

    _selectionExplainer = new window.SelectionExplainer.SelectionExplainer();
    createSelectionToolbar();
    bindSelectionListener();
  }

  function createSelectionToolbar() {
    if (_selectionToolbarEl) return;
    _selectionToolbarEl = document.createElement('div');
    _selectionToolbarEl.id = 'learningSelectionToolbar';
    _selectionToolbarEl.className = 'learning-selection-toolbar';
    _selectionToolbarEl.style.cssText = `
      position: absolute;
      display: none;
      background: #4f46e5;
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      user-select: none;
    `;
    _selectionToolbarEl.innerHTML = '📖 AI 解释';
    _selectionToolbarEl.addEventListener('click', onSelectionToolbarClick);
    document.body.appendChild(_selectionToolbarEl);
  }

  function bindSelectionListener() {
    if (_selectionListenerBound) return;
    _selectionListenerBound = true;

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || !_selectionExplainer) return;

      const text = _selectionExplainer.extractSelectedText(sel);
      if (!text || text.length < 2) {
        hideSelectionToolbar();
        return;
      }

      const inContent = _selectionExplainer.isInLearningContent(sel);
      if (!inContent) {
        hideSelectionToolbar();
        return;
      }

      // Position toolbar above the selection
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hideSelectionToolbar();
        return;
      }

      _selectionExplainer.setCurrentSelection(text);
      showSelectionToolbar(rect.left + rect.width / 2, rect.top);
    });
  }

  function showSelectionToolbar(x, y) {
    if (!_selectionToolbarEl) return;
    _selectionToolbarEl.style.display = 'block';
    _selectionToolbarEl.style.left = (window.scrollX + x - 30) + 'px';
    _selectionToolbarEl.style.top = (window.scrollY + y - 40) + 'px';
    _selectionExplainer.showToolbar();
  }

  function hideSelectionToolbar() {
    if (!_selectionToolbarEl) return;
    _selectionToolbarEl.style.display = 'none';
    if (_selectionExplainer) _selectionExplainer.hideToolbar();
  }

  async function onSelectionToolbarClick() {
    if (!_selectionExplainer) return;
    const text = _selectionExplainer.getCurrentSelection();
    if (!text) return;

    hideSelectionToolbar();
    _selectionExplainer.setExplaining(true);

    // Read chapter context
    const md = document.getElementById('markdownBody');
    const context = md ? md.querySelector('h1, h2')?.textContent || '' : '';

    showExplanationModal('🤔 AI 正在解释...', '');

    try {
      const explanation = await window.__TAURI__.core.invoke('explain_selection', { text, context });
      _selectionExplainer.setExplanation(explanation);
      showExplanationModal('📖 AI 解释', explanation);
    } catch (err) {
      showExplanationModal('❌ 解释失败', `${err.message}<br><small>Sprint 3 决策：Agent 失败显式报错</small>`);
    } finally {
      _selectionExplainer.setExplaining(false);
    }
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
      if (_selectionToolbarEl) { _selectionToolbarEl.remove(); _selectionToolbarEl = null; }
      _quizPanel = null;
      _selectionExplainer = null;
      _scrollListenerBound = false;
      _selectionListenerBound = false;
    }
  };
})();
