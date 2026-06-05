/**
 * Review Scheduler
 * Ebbinghaus forgetting curve + spaced repetition for learning concepts
 *
 * Sprint 4: 遗忘曲线提醒系统
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') return;

  const EBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30];

  function formatLocalTime(date) {
    const d = date || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  class ReviewScheduler {
    constructor() {}

    /**
     * Compute next review interval based on Ebbinghaus curve + rating adjustment
     * @param {number} reviewCount - how many times reviewed so far
     * @param {string} rating - 'mastered' | 'learning' | 'struggling'
     * @returns {number} interval in days
     */
    computeNextInterval(reviewCount, rating) {
      const base = EBINGHAUS_INTERVALS[Math.min(reviewCount, EBINGHAUS_INTERVALS.length - 1)];

      if (rating === 'struggling') {
        return Math.max(1, Math.floor(base / 2));
      }
      if (rating === 'learning') {
        return Math.max(1, Math.floor(base * 0.75));
      }
      return base;
    }

    /**
     * Check if a review item is due
     * @param {string} nextReviewAt - "YYYY-MM-DD HH:mm:ss"
     * @returns {boolean}
     */
    isDue(nextReviewAt) {
      const due = new Date(nextReviewAt.replace(/-/g, '/'));
      const now = new Date();
      return now >= due;
    }

    /**
     * Build initial review schedule from project concepts and quiz history
     * @param {Object} concepts - project.json concepts map
     * @param {Object} quizHistory - quiz-history.json object
     * @returns {Object} schedule object with items array
     */
    computeSchedule(concepts, quizHistory) {
      const items = [];
      const entries = (quizHistory && quizHistory.entries) || [];

      for (const [conceptName, conceptData] of Object.entries(concepts || {})) {
        // Find quiz entries related to this concept's source chapter
        const chapterEntries = entries.filter(e => {
          const entryFile = e.chapter_file || '';
          const sourceFile = conceptData.source_chapter || '';
          return entryFile === sourceFile || sourceFile.endsWith(entryFile) || entryFile.endsWith(sourceFile);
        });

        // Count reviews from quiz history
        const reviewCount = chapterEntries.length;

        // Get last rating from most recent quiz
        let lastRating = conceptData.status || 'learning';
        if (chapterEntries.length > 0) {
          const lastEntry = chapterEntries[chapterEntries.length - 1];
          lastRating = lastEntry.rating || lastRating;
        }

        // Compute next review date
        let nextReviewAt;
        if (chapterEntries.length > 0) {
          const lastEntry = chapterEntries[chapterEntries.length - 1];
          const lastDate = new Date(lastEntry.timestamp.replace(/-/g, '/'));
          const interval = this.computeNextInterval(reviewCount, lastRating);
          nextReviewAt = formatLocalTime(addDays(lastDate, interval));
        } else {
          // No quiz history: first review 1 day after concept was introduced
          const updatedAt = conceptData.updated_at ? new Date(conceptData.updated_at.replace(/-/g, '/')) : new Date();
          nextReviewAt = formatLocalTime(addDays(updatedAt, 1));
        }

        items.push({
          concept: conceptName,
          source_chapter: conceptData.source_chapter || '',
          review_count: reviewCount,
          last_reviewed: chapterEntries.length > 0 ? chapterEntries[chapterEntries.length - 1].timestamp : (conceptData.updated_at || ''),
          next_review_at: nextReviewAt,
          last_rating: lastRating,
          status: this.isDue(nextReviewAt) ? 'due' : 'upcoming'
        });
      }

      return { version: '1.0', items };
    }

    /**
     * Mark an item as reviewed and compute next review date
     * @param {Object} item - review schedule item
     * @param {string} rating - 'mastered' | 'learning' | 'struggling'
     */
    markReviewed(item, rating) {
      item.review_count = (item.review_count || 0) + 1;
      item.last_rating = rating;
      item.last_reviewed = formatLocalTime();

      const interval = this.computeNextInterval(item.review_count, rating);
      item.next_review_at = formatLocalTime(addDays(new Date(), interval));
      item.status = 'upcoming';
    }

    /**
     * Postpone an item to tomorrow
     * @param {Object} item - review schedule item
     */
    postpone(item) {
      item.next_review_at = formatLocalTime(addDays(new Date(), 1));
      item.status = 'upcoming';
    }

    /**
     * Get due review items from Rust backend
     * @param {string} projectPath
     * @returns {Promise<Array>}
     */
    async getDueItems(projectPath) {
      if (!window.__TAURI__ || !window.__TAURI__.core) return [];
      try {
        const items = await window.__TAURI__.core.invoke('get_review_items', { projectPath });
        return items || [];
      } catch (err) {
        console.warn('[ReviewScheduler] getDueItems failed:', err);
        return [];
      }
    }

    /**
     * Load review cards (prompts + key points) for due items
     * @param {string} projectPath
     * @returns {Promise<Object>} map of concept -> ReviewCard
     */
    async getReviewCards(projectPath) {
      if (!window.__TAURI__ || !window.__TAURI__.core) return {};
      try {
        const cardsPath = projectPath + '/.learning/review-cards.json';
        const content = await window.__TAURI__.core.invoke('read_text_file', { filePath: cardsPath });
        if (!content) return {};
        const data = JSON.parse(content);
        const map = {};
        (data.items || []).forEach(card => {
          map[card.concept] = card;
        });
        return map;
      } catch (err) {
        console.warn('[ReviewScheduler] getReviewCards failed:', err);
        return {};
      }
    }

    /**
     * Mark a concept as reviewed and update schedule on backend
     * @param {string} projectPath
     * @param {string} concept
     * @param {string} rating
     */
    async syncMarkReviewed(projectPath, concept, rating) {
      if (!window.__TAURI__ || !window.__TAURI__.core) return;
      try {
        await window.__TAURI__.core.invoke('update_review_schedule', {
          projectPath,
          concept,
          rating
        });
      } catch (err) {
        console.warn('[ReviewScheduler] syncMarkReviewed failed:', err);
      }
    }

    /**
     * Postpone a concept to tomorrow on backend
     * @param {string} projectPath
     * @param {string} concept
     */
    async syncPostpone(projectPath, concept) {
      if (!window.__TAURI__ || !window.__TAURI__.core) return;
      try {
        await window.__TAURI__.core.invoke('postpone_review_item', {
          projectPath,
          concept
        });
      } catch (err) {
        console.warn('[ReviewScheduler] syncPostpone failed:', err);
      }
    }
  }

  window.ReviewScheduler = ReviewScheduler;
  window.EBINGHAUS_INTERVALS = EBINGHAUS_INTERVALS;
})();
