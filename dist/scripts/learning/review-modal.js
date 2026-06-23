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
      const optionBtns = this._card.querySelectorAll('.quiz-option-btn');
      optionBtns.forEach((btn, idx) => {
        btn.style.pointerEvents = 'none';
        if (idx === question.answer) {
          btn.style.borderColor = '#10b981';
          btn.style.background = 'rgba(16,185,129,0.15)';
        } else if (idx === selectedIdx && !isCorrect) {
          btn.style.borderColor = '#ef4444';
          btn.style.background = 'rgba(239,68,68,0.15)';
        }
      });

      // Show feedback area
      const feedbackArea = this._card.querySelector('#reviewFeedbackArea');
      if (feedbackArea) {
        if (isCorrect) {
          feedbackArea.innerHTML = `<div style="color:#10b981;font-weight:600;font-size:14px;">✅ 回答正确</div>`;
        } else {
          // Wrong: show key_points
          const kps = (conceptCard && conceptCard.key_points) || [];
          let kpHtml = '<div style="color:#ef4444;font-weight:600;font-size:14px;margin-bottom:8px;">❌ 回答错误，以下是你需要的重点：</div>';
          if (kps.length > 0) {
            kpHtml += kps.map(kp => `<div style="margin-bottom:4px;padding:6px 10px;background:rgba(239,68,68,0.08);border-radius:6px;color:#e2e8f0;font-size:13px;">• ${kp}</div>`).join('');
          } else {
            kpHtml += '<div style="color:#64748b;font-style:italic;font-size:13px;">（暂无重点提炼）</div>';
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
      overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(15,23,42,0.75);
        backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease;
      `;

      const card = document.createElement('div');
      card.className = 'review-modal-card';
      card.style.cssText = `
        width: 560px; max-height: 85vh; overflow-y: auto;
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid rgba(129,140,248,0.25);
        border-radius: 20px;
        box-shadow: 0 25px 80px rgba(0,0,0,0.5);
        padding: 32px;
        animation: cardIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      `;

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
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
          <div style="width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#818cf8,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 8px 20px rgba(129,140,248,0.3);">🧠</div>
          <div>
            <div style="font-size:20px;font-weight:700;color:#f8fafc;">今日复习</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:2px;">根据遗忘曲线，今天有 ${conceptCount} 项内容需要回顾</div>
          </div>
        </div>

        <div style="display:flex;gap:12px;margin-bottom:24px;">
          <div style="flex:1;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.06);text-align:center;">
            <div style="font-size:22px;font-weight:700;color:#f59e0b;">${conceptCount}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px;">薄弱概念</div>
          </div>
          <div style="flex:1;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.06);text-align:center;">
            <div style="font-size:22px;font-weight:700;color:#10b981;">${estimatedMinutes}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px;">预计分钟</div>
          </div>
        </div>

        <div style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">💡 薄弱概念</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
          ${dueConcepts.map(item => `
            <div style="padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);position:relative;overflow:hidden;">
              <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${item.last_rating === 'struggling' ? '#ef4444' : '#f59e0b'};"></div>
              <div style="font-size:14px;font-weight:600;color:#f1f5f9;padding-left:8px;">${item.concept}</div>
              <div style="font-size:11px;color:#64748b;margin-top:4px;padding-left:8px;">来源：${item.source_chapter || '未知'}</div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex;gap:12px;">
          <button id="reviewStartBtn" style="flex:1;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#818cf8,#a78bfa);color:white;box-shadow:0 4px 14px rgba(129,140,248,0.3);">开始复习</button>
          <button id="reviewPostponeBtn" style="flex:1;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#94a3b8;">稍后提醒</button>
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="font-size:16px;font-weight:700;color:#f8fafc;">🧠 复习测验</div>
          <div style="font-size:13px;color:#64748b;">${progress}</div>
        </div>

        <div style="background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.2);border-radius:14px;padding:20px;margin-bottom:20px;">
          <div style="font-size:18px;font-weight:700;color:#f8fafc;margin-bottom:4px;">${item.concept}</div>
          <div style="font-size:12px;color:#94a3b8;">测验 ${qIdx + 1}/${totalQ}</div>
        </div>

        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="font-size:15px;color:#f1f5f9;line-height:1.6;font-weight:500;">${question.question}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          ${question.options.map((opt, oi) => `
            <button class="quiz-option-btn" data-opt-index="${oi}" style="width:100%;padding:12px 16px;border-radius:10px;font-size:14px;cursor:pointer;text-align:left;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e2e8f0;transition:all 0.2s;">
              ${String.fromCharCode(65 + oi)}. ${opt}
            </button>
          `).join('')}
        </div>

        <div id="reviewFeedbackArea" style="display:none;margin-bottom:16px;"></div>

        <button id="reviewNextBtn" style="display:none;width:100%;padding:12px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#818cf8,#a78bfa);color:white;">下一题 →</button>

        <button id="reviewSkipBtn" style="width:100%;margin-top:10px;padding:10px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#64748b;">跳过，稍后提醒</button>
      `;

      // Bind option buttons
      const optBtns = this._card.querySelectorAll('.quiz-option-btn');
      optBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.optIndex, 10);
          this.handleQuizAnswer(idx, question);
        });
        // Hover effect
        btn.addEventListener('mouseenter', () => {
          if (btn.style.pointerEvents !== 'none') {
            btn.style.borderColor = 'rgba(129,140,248,0.5)';
            btn.style.background = 'rgba(129,140,248,0.08)';
          }
        });
        btn.addEventListener('mouseleave', () => {
          if (btn.style.pointerEvents !== 'none') {
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
            btn.style.background = 'rgba(255,255,255,0.04)';
          }
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="font-size:16px;font-weight:700;color:#f8fafc;">🧠 复习中</div>
          <div style="font-size:13px;color:#64748b;">${progress}</div>
        </div>

        <div style="background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.2);border-radius:14px;padding:20px;margin-bottom:20px;">
          <div style="font-size:18px;font-weight:700;color:#f8fafc;margin-bottom:8px;">${item.concept}</div>
          <div style="font-size:13px;color:#94a3b8;">来源：${item.source_chapter || '未知'}</div>
        </div>

        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="font-size:13px;color:#64748b;margin-bottom:6px;font-weight:600;">💡 回忆提示</div>
          <div style="font-size:15px;color:#f1f5f9;line-height:1.6;">${prompt}</div>
        </div>

        <div id="reviewAnswerArea" style="display:none;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="font-size:13px;color:#10b981;margin-bottom:6px;font-weight:600;">📖 参考答案</div>
          <div id="reviewKeyPoints" style="font-size:14px;color:#e2e8f0;line-height:1.6;"></div>
        </div>

        <button id="reviewShowAnswerBtn" style="width:100%;padding:10px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid rgba(129,140,248,0.3);background:rgba(129,140,248,0.1);color:#818cf8;margin-bottom:16px;">👁 显示答案</button>

        <div id="reviewRatingArea" style="display:none;">
          <div style="font-size:13px;color:#94a3b8;margin-bottom:12px;text-align:center;">看完答案后，你掌握得怎么样？</div>
          <div style="display:flex;gap:10px;">
            <button id="reviewMasteredBtn" style="flex:1;padding:12px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#10b981,#059669);color:white;">✓ 完全掌握</button>
            <button id="reviewFuzzyBtn" style="flex:1;padding:12px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;">～ 有点模糊</button>
            <button id="reviewStrugglingBtn" style="flex:1;padding:12px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;">✗ 完全忘了</button>
          </div>
        </div>

        <button id="reviewSkipBtn" style="width:100%;margin-top:10px;padding:10px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#64748b;">跳过，稍后提醒</button>
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
            keyPointsEl.innerHTML = '<div style="color:#64748b;font-style:italic;">（暂无详细要点）</div>';
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
