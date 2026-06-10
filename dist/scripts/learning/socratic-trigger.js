/**
 * Socratic Review — Trigger Decision
 * Sprint 8
 *
 * Pure decision: should we show the Socratic review prompt to the user?
 * Extracted as a free function for testability.
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') global.window = {};

  const QUIZ_THRESHOLD = 5;       // Show prompt after N quiz completions
  const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

  /**
   * Pure decision: when should the Socratic prompt fire?
   * @param {object} state - SocraticState snapshot
   * @param {object} ctx   - { quizCountSince, now, candidateHash }
   * @returns {object} { shouldTrigger, reason, toast? }
   */
  function decideTrigger(state, ctx) {
    const s = state || {};
    const now = ctx.now || new Date().toISOString();
    const quizCount = ctx.quizCountSince || 0;

    // Opt-out is permanent
    if (s.opt_out === true) {
      return { shouldTrigger: false, reason: 'opt_out' };
    }

    // Need to reach threshold
    if (quizCount < QUIZ_THRESHOLD) {
      return { shouldTrigger: false, reason: 'below_threshold' };
    }

    // 24h dismissed cooldown
    if (s.last_dismissed_at) {
      const dismissedAt = new Date(s.last_dismissed_at).getTime();
      if (now - dismissedAt < DISMISS_COOLDOWN_MS) {
        return { shouldTrigger: false, reason: 'dismissed_within_24h' };
      }
    }

    // 24h cluster dedup
    if (ctx.candidateHash && Array.isArray(s.recent_cluster_hashes) && s.recent_cluster_hashes.includes(ctx.candidateHash)) {
      // Check timestamp of the hash entry
      return { shouldTrigger: false, reason: 'cluster_recent' };
    }

    // Trigger!
    return {
      shouldTrigger: true,
      reason: 'threshold_reached',
      toast: {
        text: '要做次体系复习吗？',
        buttons: [
          { label: '开始', action: 'start' },
          { label: '稍后', action: 'postpone' },
          { label: '不再提醒', action: 'optout' }
        ]
      }
    };
  }

  /**
   * Async wrapper that loads state via SocraticState and calls decideTrigger.
   */
  async function checkAndTrigger({ projectPath, candidateHash }) {
    if (!window.SocraticState) return { shouldTrigger: false, reason: 'no_state_module' };
    const state = await window.SocraticState.load(projectPath);
    return decideTrigger(state, { candidateHash });
  }

  /**
   * Dev flag check: the quick-trigger button (🏛️) and Ctrl+Shift+S shortcut
   * are gated behind this. Default OFF. To enable for testing/verification:
   *   localStorage.setItem('socratic-dev-trigger', 'true')  // in DevTools
   *   then reload
   * @returns {boolean}
   */
  function isDevQuickTriggerEnabled() {
    try {
      return localStorage.getItem('socratic-dev-trigger') === 'true';
    } catch (e) {
      return false;
    }
  }

  window.SocraticTrigger = {
    decideTrigger, checkAndTrigger, isDevQuickTriggerEnabled,
    QUIZ_THRESHOLD, DISMISS_COOLDOWN_MS
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decideTrigger, checkAndTrigger, QUIZ_THRESHOLD, DISMISS_COOLDOWN_MS };
  }
})();
