/**
 * Paper Reader — AI-guided academic paper reading workspace.
 *
 * MVP Round 1 (Walking Skeleton):
 *  - Renders paper HTML + reading-order sidebar + inline guide cards.
 *  - Integrates with Tauri for file dialog and agent-bridge invocation.
 *  - Keeps minimal state machine: Idle / LoadingGuide / Reading / Error.
 */

(function (global) {
  'use strict';

  const STATES = {
    IDLE: 'Idle',
    LOADING_GUIDE: 'LoadingGuide',
    READING: 'Reading',
    FEEDBACK: 'Feedback',
    EXITING: 'Exiting',
    ERROR: 'Error'
  };

  // Per-app-session state for scroll position and card fold states.
  const sessionState = new Map();

  function getSessionState(paperFile) {
    return paperFile ? sessionState.get(paperFile) || null : null;
  }

  function setSessionState(paperFile, patch) {
    if (!paperFile) return;
    const current = sessionState.get(paperFile) || {};
    sessionState.set(paperFile, { ...current, ...patch });
  }

  function ensureStyle() {
    if (document.getElementById('paper-reader-style')) return;
    const style = document.createElement('style');
    style.id = 'paper-reader-style';
    style.textContent = `
      .paper-reader-root { display: flex; height: 100%; overflow: hidden; }
      .paper-reader-sidebar {
        width: 220px;
        flex-shrink: 0;
        border-right: 1px solid var(--border-color, #ddd);
        padding: 16px;
        overflow-y: auto;
        background: var(--bg-secondary, #f5f5f5);
      }
      .paper-reader-sidebar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .paper-reader-sidebar-header h3 { margin: 0; font-size: 14px; }
      .paper-reader-sidebar-close {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        color: var(--text-secondary, #666);
        line-height: 1;
      }
      .paper-reader-sidebar-close:hover { color: var(--text-primary, #111); }
      .paper-reader-sidebar ol { padding-left: 18px; margin: 0; }
      .paper-reader-sidebar li { margin: 6px 0; font-size: 13px; cursor: pointer; }
      .paper-reader-sidebar li.current { font-weight: bold; color: var(--accent, #2563eb); }
      .paper-reader-main { flex: 1; overflow-y: auto; padding: 24px 32px; }
      .paper-reader-section { margin-bottom: 32px; }
      .paper-reader-section h2 { font-size: 20px; margin-bottom: 12px; }
      mark.paper-reader-highlight { background: rgba(251, 243, 219, 0.8); padding: 1px 2px; border-radius: 3px; font-weight: 500; }
      .paper-reader-highlight-text { background: rgba(251, 243, 219, 0.6); padding: 2px 4px; border-radius: 3px; }
      .paper-reader-card {
        margin: 12px 0;
        padding: 12px;
        border-left: 3px solid var(--accent, #2563eb);
        background: var(--bg-card, #fafafa);
        border-radius: 4px;
      }
      .paper-reader-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
      .paper-reader-kp-index { font-size: 12px; font-weight: 700; color: var(--accent, #2563eb); background: rgba(37, 99, 235, 0.1); padding: 2px 6px; border-radius: 4px; }
      .paper-reader-term-tag { font-size: 11px; padding: 2px 6px; border-radius: 10px; color: #fff; }
      .paper-reader-term-tag.must_know { background: #dc2626; }
      .paper-reader-term-tag.good_to_know { background: #16a34a; }
      .paper-reader-term-tag.skip_first_read { background: #6b7280; }
      .paper-reader-card-toggle { margin-left: auto; background: none; border: none; cursor: pointer; font-size: 12px; color: var(--text-secondary, #666); padding: 2px 6px; border-radius: 4px; }
      .paper-reader-card-toggle:hover { background: rgba(0,0,0,0.05); color: var(--text-primary, #111); }
      .paper-reader-explanation { font-size: 14px; line-height: 1.6; }
      .paper-reader-analogy { font-size: 13px; color: var(--text-secondary, #666); margin-top: 8px; }
      .paper-reader-error { flex: 1; padding: 24px; color: #dc2626; }
      .paper-reader-fab {
        position: fixed;
        right: 32px;
        bottom: 32px;
        padding: 12px 20px;
        border-radius: 24px;
        border: none;
        background: var(--accent, #2563eb);
        color: #fff;
        font-size: 14px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        opacity: 0.5;
        transition: opacity 0.2s;
      }
      .paper-reader-fab.active { opacity: 1; }
      .paper-reader-feedback-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .paper-reader-feedback-modal {
        background: var(--color-bg-primary, #fff);
        border-radius: 12px;
        padding: 24px;
        width: 90%;
        max-width: 420px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      .paper-reader-feedback-modal h3 { margin: 0 0 16px; }
      .paper-reader-feedback-modal label { display: block; margin: 12px 0 6px; font-size: 14px; }
      .paper-reader-feedback-modal input[type=range] { width: 100%; }
      .paper-reader-feedback-modal .percentage { text-align: center; font-size: 18px; font-weight: bold; margin: 8px 0; }
      .paper-reader-feedback-modal .options { display: flex; gap: 8px; flex-wrap: wrap; }
      .paper-reader-feedback-modal .options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
      .paper-reader-feedback-modal .error { color: #dc2626; font-size: 13px; margin-top: 8px; }
      .paper-reader-feedback-modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
      .paper-reader-feedback-modal button { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; }
      .paper-reader-feedback-modal .btn-primary { background: var(--accent, #2563eb); color: #fff; }
      .paper-reader-feedback-modal .btn-secondary { background: var(--color-bg-secondary, #f5f5f5); color: var(--color-text-primary, #333); }
    `;
    document.head.appendChild(style);
  }

  class PaperReader {
    constructor(options) {
      options = options || {};
      this.container = options.container || document.body;
      // Optional external sidebar host. When set (e.g. the app's left TOC
      // panel), the reading-order nav renders there instead of inside the
      // content root — freeing the content area for the paper text.
      this.sidebarContainer = options.sidebarContainer || null;
      this.state = STATES.IDLE;
      this.guide = null;
      this.paperFile = null;
      this.root = null;
      this.elements = {};
      this.options = options;
      this.onConfirmClose = options.onConfirmClose || null;
    }

    getState() {
      return this.state;
    }

    _setState(newState) {
      this.state = newState;
    }

    /**
     * Public entry: open a paper file and render its guide.
     * For Round 1, this always loads via _loadGuide (caller can mock in tests).
     */
    async open(paperFile) {
      this.paperFile = paperFile;
      this._setState(STATES.LOADING_GUIDE);

      try {
        const guide = await this._loadGuide(paperFile);
        this.guide = guide;
        await this.render(guide);
        this._setState(STATES.READING);
      } catch (e) {
        this._showError(e.message);
        this._setState(STATES.ERROR);
      }
    }

    /**
     * Load guide from cache or invoke agent-bridge.
     * Walking Skeleton: no real cache/agent yet; returns a stub guide for tests.
     */
    async _loadGuide(paperFile) {
      // In production this will check .learning/paper-reader-guides/ and fall
      // back to invoking the agent-bridge paper-reader stage.
      // For Round 1 tests override this method.
      return this._stubGuide(paperFile);
    }

    _stubGuide(paperFile) {
      return {
        title: 'Stub Paper',
        authors: '',
        source_file: paperFile,
        generated_at: new Date().toISOString(),
        persona_level: 'beginner',
        reading_order: [
          { step: 1, section_id: 'sec_abstract', title: 'Abstract', goal: '抓住核心问题', skip: false }
        ],
        sections: [
          {
            id: 'sec_abstract',
            title: 'Abstract',
            level: 2,
            order: 1,
            goal: '抓住核心问题',
            skip: false,
            key_points: [
              {
                id: 'kp_1',
                highlight_text: 'core problem',
                term_level: 'must_know',
                human_explanation: '这是论文要解决的核心问题。',
                analogy: '就像找钥匙：你得先知道门在哪里。'
              }
            ],
            check_questions: ['论文要解决什么问题？']
          }
        ],
        summary_check_questions: ['这篇论文的核心结论是什么？']
      };
    }

    async render(guide, originalHtml) {
      ensureStyle();
      this.guide = guide;
      this._clear();

      this.root = document.createElement('div');
      this.root.id = 'paper-reader-root';
      this.root.className = 'paper-reader-root';

      const sidebar = this._renderSidebar(guide);
      sidebar.id = 'paper-reader-sidebar';

      const main = await this._renderMain(guide, originalHtml);
      main.id = 'paper-reader-main';

      if (this.sidebarContainer) {
        // Sidebar lives in the host's left panel; root only holds main so the
        // paper content uses the full content area width.
        this.root.appendChild(main);
        this.sidebarContainer.innerHTML = '';
        this.sidebarContainer.appendChild(sidebar);
      } else {
        this.root.appendChild(sidebar);
        this.root.appendChild(main);
      }
      this.container.appendChild(this.root);

      this.elements = { root: this.root, sidebar, main };
      this._renderFeedbackFab();
      this._bindScroll();
      this._restoreSessionState();
      this._setState(STATES.READING);
    }

    _restoreSessionState() {
      const saved = getSessionState(this.paperFile);
      if (!saved) return;

      if (saved.foldState) {
        const cards = Array.from(this.root.querySelectorAll('.paper-reader-card'));
        cards.forEach((card, idx) => {
          const kpId = card.dataset.keyPointId || String(idx);
          const expanded = saved.foldState[kpId];
          if (expanded === false) {
            this._toggleCard(card);
          }
        });
      }

      if (saved.scrollTop && this.elements.main) {
        this.elements.main.scrollTop = saved.scrollTop;
      }
    }

    _bindScroll() {
      if (!this.elements.main) return;
      this._scrollHandler = () => {
        this._updateCurrentSection();
        this._checkScrollForConclusion();
      };
      this.elements.main.addEventListener('scroll', this._scrollHandler);
      // Initial highlight
      this._updateCurrentSection();
    }

    _checkScrollForConclusion() {
      if (!this.elements.main || !this.guide) return;
      const conclusionSection = this.guide.sections
        ? this.guide.sections.find(s => /conclusion/i.test(s.title))
        : null;
      if (!conclusionSection) return;

      const el = document.getElementById('section-' + conclusionSection.id);
      if (!el) return;

      const mainRect = this.elements.main.getBoundingClientRect
        ? this.elements.main.getBoundingClientRect()
        : { bottom: 0 };
      const sectionRect = el.getBoundingClientRect
        ? el.getBoundingClientRect()
        : { top: Infinity };

      // Consider "reached conclusion" when the section enters the viewport.
      const reached = sectionRect.top <= mainRect.bottom;
      if (reached && this.elements.fab) {
        this.elements.fab.classList.add('active');
      }
    }

    _renderFeedbackFab() {
      const fab = document.createElement('button');
      fab.className = 'paper-reader-fab';
      fab.textContent = '完成阅读';
      fab.addEventListener('click', () => this._showFeedbackForm());
      this.root.appendChild(fab);
      this.elements.fab = fab;
    }

    _showFeedbackForm() {
      this._setState(STATES.FEEDBACK);
      const saved = getSessionState(this.paperFile)?.feedbackFormState || null;

      const overlay = document.createElement('div');
      overlay.className = 'paper-reader-feedback-overlay';
      overlay.id = 'paper-reader-feedback-overlay';

      const modal = document.createElement('div');
      modal.className = 'paper-reader-feedback-modal';

      const title = document.createElement('h3');
      title.textContent = '阅读反馈';
      modal.appendChild(title);

      const pctLabel = document.createElement('label');
      pctLabel.textContent = '你觉得自己理解了多少？';
      modal.appendChild(pctLabel);

      const pctDisplay = document.createElement('div');
      pctDisplay.className = 'percentage';
      const initialPct = saved?.understandingPercentage ?? 50;
      pctDisplay.textContent = initialPct + '%';
      modal.appendChild(pctDisplay);

      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = String(initialPct);
      range.addEventListener('input', () => {
        pctDisplay.textContent = range.value + '%';
        setSessionState(this.paperFile, {
          feedbackFormState: {
            understandingPercentage: parseInt(range.value, 10),
            methodSuitability: this._getSelectedSuitability(options)
          }
        });
      });
      modal.appendChild(range);

      const suitLabel = document.createElement('label');
      suitLabel.textContent = 'AI 的导读方式对你来说：';
      modal.appendChild(suitLabel);

      const options = document.createElement('div');
      options.className = 'options';
      [
        { value: 'too_shallow', label: '太浅了' },
        { value: 'just_right', label: '刚刚好' },
        { value: 'too_deep', label: '太深了' }
      ].forEach(opt => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.setAttribute('name', 'method_suitability');
        radio.value = opt.value;
        if (saved?.methodSuitability === opt.value) {
          radio.checked = true;
        }
        radio.addEventListener('change', () => {
          setSessionState(this.paperFile, {
            feedbackFormState: {
              understandingPercentage: parseInt(range.value, 10),
              methodSuitability: radio.value
            }
          });
        });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(opt.label));
        options.appendChild(label);
      });
      modal.appendChild(options);

      const error = document.createElement('div');
      error.className = 'error';
      modal.appendChild(error);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const dismissForm = () => {
        setSessionState(this.paperFile, { feedbackFormState: null });
        overlay.remove();
        this._setState(STATES.READING);
      };

      const skipBtn = document.createElement('button');
      skipBtn.className = 'btn-secondary';
      skipBtn.textContent = '跳过';
      skipBtn.addEventListener('click', () => {
        overlay.remove();
        this._setState(STATES.READING);
      });

      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn-primary';
      submitBtn.textContent = '提交';
      submitBtn.addEventListener('click', async () => {
        const selected = this._getSelectedSuitability(options);
        if (!selected) {
          error.textContent = '请选择方法方式是否合适';
          return;
        }
        error.textContent = '';
        await this._submitFeedback(parseInt(range.value, 10), selected);
        dismissForm();
      });

      actions.appendChild(skipBtn);
      actions.appendChild(submitBtn);
      modal.appendChild(actions);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }

    _getSelectedSuitability(optionsContainer) {
      if (!optionsContainer) return null;
      const radios = optionsContainer.querySelectorAll('input');
      for (const radio of radios) {
        if (radio.getAttribute('name') === 'method_suitability' && radio.checked) {
          return radio.value;
        }
      }
      return null;
    }

    async _submitFeedback(percentage, suitability) {
      if (!window.__TAURI__ || !this.paperFile) {
        // Web preview / test fallback: just close the form.
        this._setState(STATES.READING);
        return;
      }
      try {
        const { invoke } = window.__TAURI__.core;
        await invoke('submit_paper_reader_feedback', {
          paperFile: this.paperFile,
          understandingPercentage: percentage,
          methodSuitability: suitability
        });
        this._setState(STATES.READING);
        if (this.options.onFeedbackSubmitted) {
          this.options.onFeedbackSubmitted();
        }
      } catch (e) {
        console.error('Failed to submit paper reader feedback:', e);
        const overlay = document.getElementById('paper-reader-feedback-overlay');
        if (overlay) {
          const error = overlay.querySelector('.error');
          if (error) error.textContent = '提交失败：' + e;
        }
      }
    }

    _updateCurrentSection() {
      if (!this.elements.main || !this.elements.sidebar) return;
      const mainRect = this.elements.main.getBoundingClientRect ? this.elements.main.getBoundingClientRect() : { top: 0 };
      const sections = Array.from(this.root.querySelectorAll('.paper-reader-section'));
      let currentId = null;
      let minTop = Infinity;

      sections.forEach(sec => {
        const rect = sec.getBoundingClientRect ? sec.getBoundingClientRect() : { top: 0 };
        const top = rect.top - mainRect.top;
        if (top <= 0 && Math.abs(top) < minTop) {
          minTop = Math.abs(top);
          currentId = sec.id.replace('section-', '');
        }
      });

      // Fallback: if no section is above the viewport, highlight the first one.
      if (!currentId && sections.length > 0) {
        currentId = sections[0].id.replace('section-', '');
      }

      this._setCurrentSidebarItem(currentId);
    }

    _setCurrentSidebarItem(sectionId) {
      if (!this.elements.sidebar) return;
      const items = Array.from(this.elements.sidebar.querySelectorAll('li'));
      items.forEach(li => {
        li.classList.toggle('current', li.dataset.sectionId === sectionId);
      });
    }

    _renderSidebar(guide) {
      const sidebar = document.createElement('aside');
      sidebar.className = 'paper-reader-sidebar';

      const header = document.createElement('div');
      header.className = 'paper-reader-sidebar-header';

      const heading = document.createElement('h3');
      heading.textContent = '阅读顺序';
      header.appendChild(heading);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'paper-reader-sidebar-close';
      closeBtn.title = '退出论文导读';
      closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      closeBtn.addEventListener('click', async () => {
        if (this.onConfirmClose) {
          const confirmed = await this.onConfirmClose();
          if (!confirmed) return;
        }
        if (this.options.onClose) this.options.onClose();
      });
      header.appendChild(closeBtn);
      sidebar.appendChild(header);

      const ol = document.createElement('ol');
      (guide.reading_order || []).forEach((item, idx) => {
        const li = document.createElement('li');
        li.textContent = item.title + (item.skip ? '（可跳过）' : '');
        li.dataset.sectionId = item.section_id;
        if (idx === 0) li.className = 'current';
        li.addEventListener('click', () => this._scrollToSection(item.section_id));
        ol.appendChild(li);
      });
      sidebar.appendChild(ol);

      return sidebar;
    }

    async _renderMain(guide, originalHtml) {
      const main = document.createElement('main');
      main.className = 'paper-reader-main';

      if (originalHtml) {
        this._renderOriginalWithCards(main, guide, originalHtml);
      } else {
        const title = document.createElement('h1');
        title.textContent = guide.title || '未命名论文';
        main.appendChild(title);

        (guide.sections || []).forEach(section => {
          const step = this._readingOrderStep(guide, section.id);
          const secEl = this._renderGuideSection(section, step);
          main.appendChild(secEl);
        });
      }

      await this._postProcess(main);
      return main;
    }

    _readingOrderStep(guide, sectionId) {
      const item = (guide.reading_order || []).find(it => it.section_id === sectionId);
      return item ? item.step : null;
    }

    _renderGuideSection(section, step) {
      const secEl = document.createElement('section');
      secEl.className = 'paper-reader-section';
      secEl.id = 'section-' + section.id;

      const h2 = document.createElement('h2');
      h2.textContent = section.title;
      secEl.appendChild(h2);

      const body = document.createElement('div');
      body.className = 'paper-reader-section-body';
      body.innerHTML = `<p>${section.goal || ''}</p><p>${section.highlight_text || ''}</p>`;
      secEl.appendChild(body);

      this._appendKeyPointsAndQuestions(secEl, section, step);
      return secEl;
    }

    _renderOriginalWithCards(main, guide, originalHtml) {
      const sections = guide.sections || [];
      let nextSectionIdx = 0;
      let currentSection = null;
      let pendingSection = null;

      const temp = document.createElement('div');
      temp.innerHTML = originalHtml;

      const matchSection = (headingText) => {
        const text = (headingText || '').trim();
        if (!text) return -1;
        for (let i = nextSectionIdx; i < sections.length; i++) {
          const title = (sections[i].title || '').trim();
          if (title && (text === title || text.includes(title) || title.includes(text))) {
            return i;
          }
        }
        return -1;
      };

      const flushSection = () => {
        if (currentSection) {
          if (pendingSection) {
            const step = this._readingOrderStep(guide, pendingSection.id);
            this._appendKeyPointsAndQuestions(currentSection, pendingSection, step);
            pendingSection = null;
          }
          main.appendChild(currentSection);
          currentSection = null;
        }
      };

      Array.from(temp.childNodes).forEach(node => {
        if (node.nodeType === 1 && /^H[1-6]$/i.test(node.tagName)) {
          flushSection();
          const matchedIdx = matchSection(node.textContent);
          let sectionId = matchedIdx >= 0 ? sections[matchedIdx].id : 'sec_' + main.children.length;
          currentSection = document.createElement('section');
          currentSection.className = 'paper-reader-section';
          currentSection.id = 'section-' + sectionId;
          currentSection.appendChild(node.cloneNode(true));
          if (matchedIdx >= 0) {
            nextSectionIdx = matchedIdx + 1;
            pendingSection = sections[matchedIdx];
          }
        } else {
          if (!currentSection) {
            currentSection = document.createElement('section');
            currentSection.className = 'paper-reader-section';
            currentSection.id = 'section-preamble';
          }
          currentSection.appendChild(node.cloneNode(true));
        }
      });
      flushSection();
      this._resolveImagePaths(main);
    }

    _resolveImagePaths(main) {
      const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
      if (!convertFileSrc || !this.paperFile) return;

      const baseDir = this.paperFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const images = main.querySelectorAll('img');

      images.forEach(img => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('http') || src.startsWith('data:') || src.startsWith('file:') || src.startsWith('asset:')) {
          return;
        }

        let absolutePath = src;
        if (src.startsWith('./')) {
          absolutePath = baseDir + '/' + src.substring(2);
        } else if (src.startsWith('../')) {
          let segments = baseDir.split('/').filter(s => s.length > 0);
          let relPath = src;
          while (relPath.startsWith('../')) {
            if (segments.length > 0) segments.pop();
            relPath = relPath.substring(3);
          }
          absolutePath = segments.join('/') + '/' + relPath;
        } else if (!src.startsWith('/')) {
          absolutePath = baseDir + '/' + src;
        }

        absolutePath = absolutePath.replace(/\\/g, '/');
        let safeUrl = convertFileSrc(absolutePath);
        if (safeUrl.includes('%25')) {
          safeUrl = decodeURIComponent(safeUrl);
        }
        img.setAttribute('src', safeUrl);
      });
    }

    _appendKeyPointsAndQuestions(container, section, step) {
      (section.key_points || []).forEach((kp, idx) => {
        if (kp.highlight_text) {
          this._highlightText(container, kp.highlight_text);
        }
        container.appendChild(this._renderKeyPointCard(kp, idx + 1, step));
      });

      if (section.check_questions && section.check_questions.length) {
        const qList = document.createElement('ul');
        qList.className = 'paper-reader-check-questions';
        section.check_questions.forEach(q => {
          const li = document.createElement('li');
          li.textContent = q;
          qList.appendChild(li);
        });
        container.appendChild(qList);
      }
    }

    _highlightText(container, phrase) {
      if (!container || !phrase) return;
      const lowerPhrase = String(phrase).toLowerCase();
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      const matches = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.toLowerCase().includes(lowerPhrase)) {
          matches.push(node);
        }
      }
      for (const textNode of matches) {
        const text = textNode.textContent;
        const idx = text.toLowerCase().indexOf(lowerPhrase);
        if (idx < 0) continue;
        const before = text.slice(0, idx);
        const match = text.slice(idx, idx + phrase.length);
        const after = text.slice(idx + phrase.length);
        const mark = document.createElement('mark');
        mark.className = 'paper-reader-highlight';
        mark.textContent = match;
        const parent = textNode.parentNode;
        if (!parent) continue;
        if (before) parent.insertBefore(document.createTextNode(before), textNode);
        parent.insertBefore(mark, textNode);
        if (after) parent.insertBefore(document.createTextNode(after), textNode);
        parent.removeChild(textNode);
        break;
      }
    }

    async _postProcess(main) {
      // Prefer the main app's full markdown enhancement pipeline so the paper
      // reader gets image lightbox, mermaid, GFM alerts, Obsidian syntax, etc.
      if (window.TyporaNext && window.TyporaNext.enhanceReaderContent) {
        const baseDir = this.paperFile
          ? this.paperFile.replace(/[\\/][^\\/]+$/, '')
          : '';
        try {
          await window.TyporaNext.enhanceReaderContent(main, baseDir);
          return;
        } catch (e) {
          console.warn('PaperReader enhanceReaderContent failed, falling back:', e);
        }
      }

      // Fallback for test environments without TyporaNext.
      if (typeof renderMathInElement !== 'undefined') {
        try {
          renderMathInElement(main, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false
          });
        } catch (e) {
          console.warn('PaperReader math rendering failed:', e);
        }
      }
      if (typeof Prism !== 'undefined') {
        const codeBlocks = main.querySelectorAll('pre code[class*="language-"]');
        codeBlocks.forEach(code => {
          const language = (code.className.match(/language-(\w+)/) || [])[1];
          if (language && language.toLowerCase() !== 'mermaid') {
            try {
              Prism.highlightElement(code);
            } catch (e) {
              console.warn('PaperReader code highlight failed:', e);
            }
          }
        });
      }
    }

    _renderKeyPointCard(kp, index, step) {
      const card = document.createElement('div');
      card.className = 'paper-reader-card';
      card.dataset.expanded = 'true';
      if (kp.id) card.dataset.keyPointId = kp.id;

      const header = document.createElement('div');
      header.className = 'paper-reader-card-header';

      const orderBadge = document.createElement('span');
      orderBadge.className = 'paper-reader-kp-index';
      orderBadge.textContent = step != null ? `${step}.${index}` : `${index}`;
      header.appendChild(orderBadge);

      const tag = document.createElement('span');
      tag.className = 'paper-reader-term-tag ' + (kp.term_level || 'good_to_know');
      tag.textContent = kp.term_level === 'must_know' ? '必须懂' : kp.term_level === 'skip_first_read' ? '首次跳过' : '了解下';
      header.appendChild(tag);

      const highlight = document.createElement('span');
      highlight.className = 'paper-reader-highlight-text';
      highlight.textContent = kp.highlight_text;
      header.appendChild(highlight);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'paper-reader-card-toggle';
      toggleBtn.textContent = '折叠';
      toggleBtn.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        this._toggleCard(card);
      });
      header.appendChild(toggleBtn);

      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'paper-reader-card-body';

      const explanation = document.createElement('div');
      explanation.className = 'paper-reader-explanation';
      explanation.textContent = kp.human_explanation;
      body.appendChild(explanation);

      if (kp.analogy) {
        const analogy = document.createElement('div');
        analogy.className = 'paper-reader-analogy';
        analogy.textContent = '💡 ' + kp.analogy;
        body.appendChild(analogy);
      }

      card.appendChild(body);
      return card;
    }

    _toggleCard(card) {
      const expanded = card.dataset.expanded === 'true';
      const newExpanded = !expanded;
      card.dataset.expanded = String(newExpanded);
      const body = card.querySelector('.paper-reader-card-body');
      const toggleBtn = card.querySelector('.paper-reader-card-toggle');
      if (body) {
        body.style.display = newExpanded ? '' : 'none';
      }
      if (toggleBtn) {
        toggleBtn.textContent = newExpanded ? '折叠' : '展开';
      }
    }

    _getGuideCards() {
      if (!this.root) return [];
      return Array.from(this.root.querySelectorAll('.paper-reader-card'));
    }

    _scrollToSection(sectionId) {
      const el = document.getElementById('section-' + sectionId);
      if (el) el.scrollIntoView();
    }

    _showError(message) {
      this._clear();
      this.root = document.createElement('div');
      this.root.id = 'paper-reader-root';
      this.root.className = 'paper-reader-error';
      this.root.textContent = message;
      this.container.appendChild(this.root);
    }

    _clear() {
      if (this.root) {
        if (this._scrollHandler && this.elements.main) {
          this.elements.main.removeEventListener('scroll', this._scrollHandler);
        }
        this._scrollHandler = null;
        if (this.root.parentNode) {
          this.root.parentNode.removeChild(this.root);
        }
        this.root.id = '';
        this.root = null;
      }
      // Remove the sidebar from its external host (left TOC panel) if any.
      if (this.sidebarContainer && this.elements.sidebar) {
        if (this.elements.sidebar.parentNode === this.sidebarContainer) {
          this.sidebarContainer.removeChild(this.elements.sidebar);
        }
      }
      this.elements = {};
    }

    close() {
      if (this.elements.main) {
        const foldState = {};
        this.root.querySelectorAll('.paper-reader-card').forEach((card, idx) => {
          const kpId = card.dataset.keyPointId || String(idx);
          foldState[kpId] = card.dataset.expanded === 'true';
        });
        setSessionState(this.paperFile, {
          scrollTop: this.elements.main.scrollTop || 0,
          foldState
        });
      }
      this._setState(STATES.EXITING);
      this._clear();
      this.guide = null;
      this.paperFile = null;
      this._setState(STATES.IDLE);
    }

    unmount() {
      this.close();
      const style = document.getElementById('paper-reader-style');
      if (style && style.parentNode) style.parentNode.removeChild(style);
    }
  }

  // Exports
  global.PaperReader = PaperReader;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PaperReader, STATES };
  }
})(typeof window !== 'undefined' ? window : global);
