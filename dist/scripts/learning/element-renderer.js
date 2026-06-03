/**
 * Element Renderer
 * Renders learning elements (!concept / !question / !quiz) as interactive cards
 *
 * Sprint 3 task 3.1
 *
 * State machine (quiz):
 *   unanswered → answering → submitted
 *                    ↑         ↓
 *                    └── reset ┘
 */

(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') global.window = {};
  if (typeof document === 'undefined') {
    global.document = {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        children: [],
        _classes: [],
        _attrs: {},
        classList: {
          _set: [],
          add(c) { if (!this._set.includes(c)) this._set.push(c); },
          remove(c) { this._set = this._set.filter(x => x !== c); },
          contains(c) { return this._set.includes(c); },
          toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
        },
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
        removeEventListener() {},
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = v; this.children = []; },
        get textContent() { return this._textContent; },
        set textContent(v) { this._textContent = v; }
      })
    };
  }

  // ============================================
  // Parser: extract learning elements from Markdown
  // ============================================

  /**
   * Parse learning elements from Markdown text
   * @param {string} markdown
   * @returns {Array<{type, title, body, question, answer, options}>}
   */
  function parseLearningElements(markdown) {
    if (!markdown || typeof markdown !== 'string') return [];
    const blocks = [];
    const lines = markdown.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      // Detect callout: `> [!type] title`
      const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
      if (calloutMatch) {
        const type = calloutMatch[1].toLowerCase();
        const title = calloutMatch[2].trim();

        if (type === 'concept') {
          const body = collectCalloutBody(lines, i + 1);
          blocks.push({ type: 'concept', title, body });
          i += 1 + body.length;
        } else if (type === 'question') {
          const { questionBody, answerBody, linesConsumed } = collectQuestionBody(lines, i + 1);
          blocks.push({
            type: 'question',
            title,
            question: questionBody.join('\n'),
            answer: answerBody.join('\n')
          });
          i += 1 + linesConsumed;
        } else if (type === 'quiz') {
          const quizData = collectQuizBody(lines, i + 1);
          blocks.push({
            type: 'quiz',
            title,
            question: quizData.question,
            options: quizData.options,
            multiple: quizData.multiple
          });
          i += 1 + quizData.lineCount;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return blocks;
  }

  /**
   * Collect body lines of a callout (lines starting with `>`)
   */
  function collectCalloutBody(lines, startIdx) {
    const body = [];
    let i = startIdx;
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(/^>(\s*>)*\s*/)) {
        body.push(l.replace(/^>(\s*>)*\s?/, ''));
        i++;
      } else {
        break;
      }
    }
    return body;
  }

  /**
   * Collect question body and optional answer
   */
  function collectQuestionBody(lines, startIdx) {
    const questionBody = [];
    const answerBody = [];
    let i = startIdx;
    let linesConsumed = 0;

    // Collect question lines until we hit [!answer] (supports nested > >)
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(/^>(\s*>)*\s*\[!answer\]/i)) {
        i++;
        linesConsumed++;
        break;
      }
      if (l.match(/^>(\s*>)*\s*/)) {
        questionBody.push(l.replace(/^>(\s*>)*\s?/, ''));
        i++;
        linesConsumed++;
      } else {
        break;
      }
    }

    // Collect answer lines
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(/^>(\s*>)*\s*/)) {
        answerBody.push(l.replace(/^>(\s*>)*\s?/, ''));
        i++;
        linesConsumed++;
      } else {
        break;
      }
    }

    return { questionBody, answerBody, linesConsumed };
  }

  /**
   * Collect quiz question + options
   */
  function collectQuizBody(lines, startIdx) {
    const body = [];
    let i = startIdx;
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(/^>(\s*>)*\s*/)) {
        body.push(l.replace(/^>(\s*>)*\s?/, ''));
        i++;
      } else {
        break;
      }
    }

    // First non-empty line is the question (after stripping leading "1. ")
    let question = '';
    for (const l of body) {
      const m = l.match(/^\s*\d+\.\s*(.+)$/);
      if (m) {
        question = m[1].trim();
        break;
      }
    }

    // Options: lines starting with `- ` or `* ` (with optional ✓ marker)
    const options = [];
    for (const l of body) {
      const optMatch = l.match(/^\s*[-*]\s*([A-Z])\.\s*(.+?)(?:\s*✓)?$/);
      if (optMatch) {
        const label = optMatch[1];
        const text = optMatch[2].trim();
        const correct = l.includes('✓');
        options.push({ label, text, correct });
      }
    }

    // Multiple = more than one correct option
    const correctCount = options.filter(o => o.correct).length;
    const multiple = correctCount > 1;

    return { question, options, multiple, lineCount: body.length };
  }

  // ============================================
  // Renderer: produce HTML for each card type
  // ============================================

  class ElementRenderer {
    constructor() {
      this._onOptionClick = null;
      this._onSubmit = null;
      this._onShowAnswer = null;
    }

    /**
     * Render a concept card
     * @param {{title: string, body: string}} block
     * @returns {string} HTML
     */
    renderConceptCard(block) {
      const title = this._escapeHtml(block.title || '');
      const body = this._escapeHtml(block.body || '').replace(/\n/g, '<br>');
      return `<div class="learning-element learning-concept" data-learning-type="concept">
  <div class="concept-icon">📚</div>
  <div class="concept-body">
    <div class="concept-title">${title}</div>
    <div class="concept-content">${body}</div>
    <div class="concept-tooltip" data-hover="true">${this._escapeHtml(block.body || '')}</div>
  </div>
</div>`;
    }

    /**
     * Render a question card
     * @param {{title: string, question: string, answer: string}} block
     * @returns {string} HTML
     */
    renderQuestionCard(block) {
      const title = this._escapeHtml(block.title || '');
      const question = this._escapeHtml(block.question || '');
      const answer = this._escapeHtml(block.answer || '');
      const hasAnswer = !!block.answer;

      return `<div class="learning-element learning-question" data-learning-type="question">
  <div class="question-icon">❓</div>
  <div class="question-body">
    <div class="question-title">${title}</div>
    <div class="question-content">${question.replace(/\n/g, '<br>')}</div>
    ${hasAnswer ? `<button class="toggle-answer" data-expanded="false">查看解释</button>
    <div class="question-answer" style="display:none">${answer.replace(/\n/g, '<br>')}</div>` : ''}
  </div>
</div>`;
    }

    /**
     * Render a quiz card
     * @param {{question: string, options: Array, multiple: boolean}} block
     * @returns {string} HTML
     */
    renderQuizCard(block) {
      const question = this._escapeHtml(block.question || '');
      const multiple = !!block.multiple;
      const inputType = multiple ? 'checkbox' : 'radio';

      const optionsHtml = (block.options || []).map(opt => {
        const label = this._escapeHtml(opt.label || '');
        const text = this._escapeHtml(opt.text || '');
        return `<label class="quiz-option" data-correct="${opt.correct ? 'true' : 'false'}" data-label="${label}">
  <input type="${inputType}" name="quiz-option" value="${label}">
  <span class="quiz-option-label">${label}</span>
  <span class="quiz-option-text">${text}</span>
</label>`;
      }).join('\n');

      return `<div class="learning-element learning-quiz" data-learning-type="quiz" data-type="${multiple ? 'multiple' : 'single'}">
  <div class="quiz-icon">✏️</div>
  <div class="quiz-body">
    <div class="quiz-question">${question}</div>
    <div class="quiz-options">${optionsHtml}</div>
    <button class="submit-answer">提交答案</button>
    <div class="quiz-feedback" style="display:none"></div>
  </div>
</div>`;
    }

    /**
     * Render all blocks in a Markdown string into a single HTML
     * @param {string} markdown
     * @returns {string} HTML
     */
    renderMarkdown(markdown) {
      const blocks = parseLearningElements(markdown);
      return blocks.map(b => {
        if (b.type === 'concept') return this.renderConceptCard(b);
        if (b.type === 'question') return this.renderQuestionCard(b);
        if (b.type === 'quiz') return this.renderQuizCard(b);
        return '';
      }).join('\n');
    }

    /**
     * Render into a DOM container, attaching event listeners
     * @param {HTMLElement} root
     * @param {string} markdown
     */
    renderInto(root, markdown) {
      if (!root) return;
      root.innerHTML = this.renderMarkdown(markdown);
      this._bindEvents(root);
    }

    /**
     * Bind click events to rendered elements
     */
    _bindEvents(root) {
      // Question: toggle answer
      root.querySelectorAll && Array.from(root.querySelectorAll('.toggle-answer')).forEach(btn => {
        btn.addEventListener('click', (e) => {
          const answerDiv = btn.nextElementSibling;
          if (answerDiv) {
            const expanded = btn.dataset.expanded === 'true';
            btn.dataset.expanded = expanded ? 'false' : 'true';
            btn.textContent = expanded ? '查看解释' : '收起解释';
            answerDiv.style.display = expanded ? 'none' : 'block';
            if (this._onShowAnswer) this._onShowAnswer(btn);
          }
        });
      });

      // Quiz: option click
      root.querySelectorAll && Array.from(root.querySelectorAll('.quiz-option')).forEach(opt => {
        opt.addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') {
            const input = opt.querySelector('input');
            if (input) input.checked = !input.checked;
          }
          opt.classList.toggle('selected', opt.querySelector('input')?.checked);
          if (this._onOptionClick) this._onOptionClick(opt);
        });
      });

      // Quiz: submit
      root.querySelectorAll && Array.from(root.querySelectorAll('.submit-answer')).forEach(btn => {
        btn.addEventListener('click', (e) => {
          const card = btn.closest('.learning-quiz');
          if (!card) return;
          const feedback = card.querySelector('.quiz-feedback');
          const selected = Array.from(card.querySelectorAll('.quiz-option')).filter(
            o => o.querySelector('input')?.checked
          );
          const correct = Array.from(card.querySelectorAll('.quiz-option[data-correct="true"]'));
          const isCorrect = selected.length === correct.length &&
            selected.every(s => s.dataset.correct === 'true');
          if (feedback) {
            feedback.style.display = 'block';
            feedback.className = `quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
            feedback.textContent = isCorrect ? '✅ 正确！' : '❌ 再想想';
          }
          if (this._onSubmit) this._onSubmit({ card, selected, isCorrect });
        });
      });
    }

    /**
     * Escape HTML special characters
     */
    _escapeHtml(text) {
      if (text === null || text === undefined) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  // ============================================
  // Public API
  // ============================================

  window.ElementRenderer = ElementRenderer;
  window.parseLearningElements = parseLearningElements;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ElementRenderer,
      parseLearningElements,
      collectCalloutBody,
      collectQuestionBody,
      collectQuizBody
    };
  }
})();
