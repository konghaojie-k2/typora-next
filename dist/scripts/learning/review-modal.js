/**
 * Review Modal (PB4: 客观题版)
 * Shows objective quiz questions from review-cards.json, auto-grades,
 * and shows key_points on wrong answers. Falls back to self-rating if no cards.
 *
 * Sprint 4 + PB4: 遗忘曲线复习 + 概念级客观测验
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') return;

  class ReviewModal {
    constructor(options) {
      this.state = 'hidden';
      this.items = (options && options.items) || [];
      this.cards = (options && options.cards) || {}; // concept -> ReviewCard
      this.currentIndex = 0;
      this._currentQuestionIdx = 0; // which question within current concept
      this.onComplete = (options && options.onComplete) || (() => {});
      this.onPostpone = (options && options.onPostpone) || (() => {});
      this._overlay = null;
      this._card = null;
      this._answers = []; // [{concept, rating, answers: [{question_id, is_correct}], correct_count, total_count}]
    }

    getState() { return this.state; }

    show() {
      if (this.state !== 'hidden') return;
      this._createDOM();
      this.state = 'due_found';
    }

    startReview() {
      if (this.state !== 'due_found') return;
      this.state = 'reviewing';
      this.currentIndex = 0;
      this._currentQuestionIdx = 0;
      this._answers = [];
      this._renderReviewingState();
    }

    // ============================================
    // Quiz-based answer submission
    // ============================================

    /**
     * Handle an answer click for the current quiz question
     * @param {number} selectedIdx - The option index the user chose
     * @param {object} question - The quiz question object
     */
    handleQuizAnswer(selectedIdx, question) {
      if (this.state !== 'reviewing') return;

      const isCorrect = selectedIdx === question.answer;
      const conceptCard = this.cards[this.items[this.currentIndex].concept];
      const totalQuestions = (conceptCard && conceptCard.quiz_questions) ? conceptCard.quiz_questions.length : 0;

      // Track this answer
      if (!this._answers[this.currentIndex]) {
        this._answers[this.currentIndex] = {
          concept: this.items[this.currentIndex].concept,
          answers: [],
          correct_count: 0,
          total_count: totalQuestions
        };
      }
      this._answers[this.currentIndex].answers.push({
        question_id: question.id || ('q' + this._currentQuestionIdx),
        is_correct: isCorrect
      });
      if (isCorrect) this._answers[this.currentIndex].correct_count++;

      // Show result
      this._showQuizResult(isCorrect, selectedIdx, question);
    }

    /**
     * Show correct/wrong feedback for the answered question
     */
    _showQuizResult(isCorrect, selectedIdx, question) {
      if (!this._card) return;

      const conceptCard = this.cards[this.items[this.currentIndex].concept];
      const totalQuestions = (conceptCard && conceptCard.quiz_questions) ? conceptCard.quiz_questions.length : 0;
      const isLastQuestion = this._currentQuestionIdx >= totalQuestions - 1;
      const hasNextConcept = this.currentIndex < this.items.length - 1;

      // Disable all option buttons
      const optionBtns = this._card.querySelectorAll('.review-option-btn');
      optionBtns.forEach((btn, idx) => {
        btn.style.pointerEvents = 'none';
        if (idx === question.answer) {
          btn.classList.add('correct');
        } else if (idx === selectedIdx && !isCorrect) {
          btn.classList.add('wrong');
        }
      });

      // Show feedback area
      const feedbackArea = this._card.querySelector('#reviewFeedbackArea');
      if (feedbackArea) {
        if (isCorrect) {
          feedbackArea.innerHTML = `<div class="review-feedback-correct">✅ 回答正确</div>`;
        } else {
          // Wrong: show key_points
          const kps = (conceptCard && conceptCard.key_points) || [];
          let kpHtml = '<div class="review-feedback-wrong-title">❌ 回答错误，以下是你需要的重点：</div>';
          if (kps.length > 0) {
            kpHtml += kps.map(kp => `<div class="review-key-point">• ${kp}</div>`).join('');
          } else {
            kpHtml += '<div class="review-feedback-empty">（暂无重点提炼）</div>';
          }
          feedbackArea.innerHTML = kpHtml;
        }
        feedbackArea.style.display = 'block';
      }

      // Show next button
      const nextBtn = this._card.querySelector('#reviewNextBtn');
      if (nextBtn) {
        if (isLastQuestion) {
          nextBtn.textContent = hasNextConcept ? '下一概念 →' : '完成复习 ✓';
        } else {
          nextBtn.textContent = '下一题 →';
        }
        nextBtn.style.display = 'block';
      }
    }

    /**
     * Advance to the next question/concept
     */
    nextQuestion() {
      if (this.state !== 'reviewing') return;

      const conceptCard = this.cards[this.items[this.currentIndex].concept];
      const totalQuestions = (conceptCard && conceptCard.quiz_questions) ? conceptCard.quiz_questions.length : 0;

      if (this._currentQuestionIdx < totalQuestions - 1) {
        // More questions for this concept
        this._currentQuestionIdx++;
        this._renderCurrentItem();
      } else {
        // All questions done for this concept → derive rating
        this._finalizeConceptRating();
        this.currentIndex++;
        this._currentQuestionIdx = 0;

        if (this.currentIndex >= this.items.length) {
          this.complete();
        } else {
          this._renderCurrentItem();
        }
      }
    }

    /**
     * Derive rating from quiz results for the current concept
     */
    _finalizeConceptRating() {
      const record = this._answers[this.currentIndex];
      if (!record) return;
      const ratio = record.correct_count / Math.max(record.total_count, 1);
      let rating;
      if (ratio >= 0.8) {
        rating = 'mastered';
      } else if (ratio >= 0.5) {
        rating = 'learning';
      } else {
        rating = 'struggling';
      }
      record.rating = rating;
    }

    // ============================================
    // Self-rating fallback (when no review-cards.json)
    // ============================================

    submitSelfRating(rating) {
      if (this.state !== 'reviewing') return;

      if (!this._answers[this.currentIndex]) {
        this._answers[this.currentIndex] = {
          concept: this.items[this.currentIndex].concept,
          answers: [],
          correct_count: 0,
          total_count: 0
        };
      }
      this._answers[this.currentIndex].rating = rating;

      this.currentIndex++;
      this._currentQuestionIdx = 0;

      if (this.currentIndex >= this.items.length) {
        this.complete();
      } else {
        this._renderCurrentItem();
      }
    }

    // ============================================
    // Complete / Postpone
    // ============================================

    complete() {
      if (this.state === 'completed' || this.state === 'hidden') return;
      this.state = 'completed';
      // Ensure all entries have rating
      const finalAnswers = this._answers.map(a => a || { concept: 'unknown', rating: 'learning', answers: [] });
      this.onComplete(finalAnswers);
      this.teardown();
    }

    postpone() {
      if (this.state === 'hidden') return;
      this.state = 'hidden';
      this.onPostpone();
      this.teardown();
    }

    dismiss() {
      if (this.state === 'hidden') return;
      this.state = 'hidden';
      this.teardown();
    }

    teardown() {
      if (this._overlay) {
        this._overlay.remove();
        this._overlay = null;
        this._card = null;
      }
      if (this.state !== 'completed') {
        this.state = 'hidden';
      }
    }

    // ============================================
    // DOM Creation
    // ============================================

    _createDOM() {
      const overlay = document.createElement('div');
      overlay.className = 'review-modal-overlay';

      const card = document.createElement('div');
      card.className = 'review-modal-card';

      this._renderDueFoundState(card);

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      this._overlay = overlay;
      this._card = card;

      // ESC key handler
      this._escHandler = (e) => {
        if (e.key === 'Escape') this.dismiss();
      };
      document.addEventListener('keydown', this._escHandler);

      // Click outside to dismiss (not postpone)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.dismiss();
      });
    }

    _renderDueFoundState(card) {
      const dueConcepts = this.items.filter(i => i.status === 'due');
      const conceptCount = dueConcepts.length;
      const estimatedMinutes = Math.max(3, conceptCount * 2);

      card.innerHTML = `
        <div class="review-modal-header">
          <div class="review-modal-icon">🧠</div>
          <div>
            <div class="review-modal-title">今日复习</div>
            <div class="review-modal-subtitle">根据遗忘曲线，今天有 ${conceptCount} 项内容需要回顾</div>
          </div>
        </div>

        <div class="review-modal-stats">
          <div class="review-modal-stat">
            <div class="review-modal-stat-value warning">${conceptCount}</div>
            <div class="review-modal-stat-label">薄弱概念</div>
          </div>
          <div class="review-modal-stat">
            <div class="review-modal-stat-value success">${estimatedMinutes}</div>
            <div class="review-modal-stat-label">预计分钟</div>
          </div>
        </div>

        <div class="review-modal-section-title">💡 薄弱概念</div>
        <div class="review-concept-list">
          ${dueConcepts.map(item => `
            <div class="review-concept-item ${item.last_rating === 'struggling' ? 'struggling' : ''}">
              <div class="review-concept-name">${item.concept}</div>
              <div class="review-concept-source">来源：${item.source_chapter || '未知'}</div>
            </div>
          `).join('')}
        </div>

        <div class="review-modal-actions">
          <button id="reviewStartBtn" class="review-btn review-btn-primary">开始复习</button>
          <button id="reviewPostponeBtn" class="review-btn">稍后提醒</button>
        </div>
      `;

      const startBtn = card.querySelector('#reviewStartBtn');
      const postponeBtn = card.querySelector('#reviewPostponeBtn');

      if (startBtn) {
        startBtn.addEventListener('click', () => this.startReview());
      }
      if (postponeBtn) {
        postponeBtn.addEventListener('click', () => this.postpone());
      }
    }

    _renderReviewingState() {
      if (!this._card) return;
      this._renderCurrentItem();
    }

    _renderCurrentItem() {
      if (!this._card || this.state !== 'reviewing') return;

      const item = this.items[this.currentIndex];
      const conceptCard = this.cards[item.concept] || {};
      const quizQuestions = conceptCard.quiz_questions || [];
      const hasQuiz = quizQuestions.length > 0;
      const progress = `${this.currentIndex + 1} / ${this.items.length}`;

      if (hasQuiz) {
        this._renderQuizQuestion(item, conceptCard, quizQuestions, progress);
      } else {
        this._renderSelfRatingFallback(item, conceptCard, progress);
      }
    }

    /**
     * Render a quiz question for objective review
     */
    _renderQuizQuestion(item, conceptCard, quizQuestions, progress) {
      const question = quizQuestions[this._currentQuestionIdx];
      if (!question) {
        // No more questions — move to next concept or complete
        this.nextQuestion();
        return;
      }

      const qIdx = this._currentQuestionIdx;
      const totalQ = quizQuestions.length;

      this._card.innerHTML = `
        <div class="review-progress">
          <div class="review-progress-title">🧠 复习测验</div>
          <div class="review-progress-count">${progress}</div>
        </div>

        <div class="review-concept-header">
          <div class="review-concept-title">${item.concept}</div>
          <div class="review-concept-meta">测验 ${qIdx + 1}/${totalQ}</div>
        </div>

        <div class="review-question-box">
          <div class="review-question-text">${question.question}</div>
        </div>

        <div class="review-options">
          ${question.options.map((opt, oi) => `
            <button class="review-option-btn" data-opt-index="${oi}">
              ${String.fromCharCode(65 + oi)}. ${opt}
            </button>
          `).join('')}
        </div>

        <div id="reviewFeedbackArea" class="review-feedback"></div>

        <button id="reviewNextBtn" class="review-next-btn">下一题 →</button>

        <button id="reviewSkipBtn" class="review-skip-btn">跳过，稍后提醒</button>
      `;

      // Bind option buttons
      const optBtns = this._card.querySelectorAll('.review-option-btn');
      optBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.optIndex, 10);
          this.handleQuizAnswer(idx, question);
        });
      });

      // Bind next button
      const nextBtn = this._card.querySelector('#reviewNextBtn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => this.nextQuestion());
      }

      // Bind skip button
      const skipBtn = this._card.querySelector('#reviewSkipBtn');
      if (skipBtn) {
        skipBtn.addEventListener('click', () => this.postpone());
      }
    }

    /**
     * Render self-rating UI when no review cards available (fallback)
     */
    _renderSelfRatingFallback(item, conceptCard, progress) {
      const prompt = conceptCard.prompt || `请回忆：${item.concept} 是什么？它的核心要点有哪些？`;

      this._card.innerHTML = `
        <div class="review-progress">
          <div class="review-progress-title">🧠 复习中</div>
          <div class="review-progress-count">${progress}</div>
        </div>

        <div class="review-concept-header">
          <div class="review-concept-title">${item.concept}</div>
          <div class="review-concept-meta">来源：${item.source_chapter || '未知'}</div>
        </div>

        <div class="review-question-box">
          <div class="review-modal-section-title">💡 回忆提示</div>
          <div class="review-question-text">${prompt}</div>
        </div>

        <div id="reviewAnswerArea" class="review-answer-area">
          <div class="review-answer-title">📖 参考答案</div>
          <div id="reviewKeyPoints" class="review-answer-content"></div>
        </div>

        <button id="reviewShowAnswerBtn" class="review-show-answer-btn">👁 显示答案</button>

        <div id="reviewRatingArea" class="review-rating-area">
          <div class="review-rating-hint">看完答案后，你掌握得怎么样？</div>
          <div class="review-rating-buttons">
            <button id="reviewMasteredBtn" class="review-rating-btn mastered">✓ 完全掌握</button>
            <button id="reviewFuzzyBtn" class="review-rating-btn learning">～ 有点模糊</button>
            <button id="reviewStrugglingBtn" class="review-rating-btn struggling">✗ 完全忘了</button>
          </div>
        </div>

        <button id="reviewSkipBtn" class="review-skip-btn">跳过，稍后提醒</button>
      `;

      const showAnswerBtn = this._card.querySelector('#reviewShowAnswerBtn');
      const answerArea = this._card.querySelector('#reviewAnswerArea');
      const keyPointsEl = this._card.querySelector('#reviewKeyPoints');
      const ratingArea = this._card.querySelector('#reviewRatingArea');
      const masteredBtn = this._card.querySelector('#reviewMasteredBtn');
      const fuzzyBtn = this._card.querySelector('#reviewFuzzyBtn');
      const strugglingBtn = this._card.querySelector('#reviewStrugglingBtn');
      const skipBtn = this._card.querySelector('#reviewSkipBtn');

      if (showAnswerBtn && answerArea && keyPointsEl && ratingArea) {
        showAnswerBtn.addEventListener('click', () => {
          showAnswerBtn.style.display = 'none';
          answerArea.style.display = 'block';
          const kps = (conceptCard.key_points || []);
          if (kps.length > 0) {
            keyPointsEl.innerHTML = kps.map(kp => `<div style="margin-bottom:4px;">• ${kp}</div>`).join('');
          } else {
            keyPointsEl.innerHTML = '<div class="review-feedback-empty">（暂无详细要点）</div>';
          }
          ratingArea.style.display = 'block';
        });
      }

      if (masteredBtn) masteredBtn.addEventListener('click', () => this.submitSelfRating('mastered'));
      if (fuzzyBtn) fuzzyBtn.addEventListener('click', () => this.submitSelfRating('learning'));
      if (strugglingBtn) strugglingBtn.addEventListener('click', () => this.submitSelfRating('struggling'));
      if (skipBtn) skipBtn.addEventListener('click', () => this.postpone());
    }
  }

  window.ReviewModal = ReviewModal;
})();
