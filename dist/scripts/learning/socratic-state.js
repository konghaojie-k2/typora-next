/**
 * Socratic Review — State Management
 * Sprint 8
 *
 * Persists trigger state in {project}/.learning/socratic-state.json
 * PHYSICALLY ISOLATED from project.json and quiz-history.json
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') global.window = {};
  if (typeof document === 'undefined') {
    global.document = { createElement: () => ({ style: {}, classList: { add:()=>{} } }) };
  }

  const DEFAULT_STATE = {
    last_socratic_at: null,
    last_dismissed_at: null,
    opt_out: false,
    quiz_count_since_last_socratic: 0,
    recent_cluster_hashes: []
  };

  class SocraticState {
    constructor(initial) {
      Object.assign(this, DEFAULT_STATE, initial || {});
    }

    static async load(projectPath) {
      if (!window.__TAURI__) return new SocraticState();
      try {
        const state = await window.__TAURI__.core.invoke('socratic_load_state', { projectPath });
        return new SocraticState(state);
      } catch (e) {
        console.warn('[SocraticState] load failed:', e);
        return new SocraticState();
      }
    }

    async save(projectPath) {
      if (!window.__TAURI__) return false;
      try {
        await window.__TAURI__.core.invoke('socratic_save_state', {
          projectPath,
          state: {
            last_socratic_at: this.last_socratic_at,
            last_dismissed_at: this.last_dismissed_at,
            opt_out: this.opt_out,
            quiz_count_since_last_socratic: this.quiz_count_since_last_socratic,
            recent_cluster_hashes: this.recent_cluster_hashes
          }
        });
        return true;
      } catch (e) {
        console.warn('[SocraticState] save failed:', e);
        return false;
      }
    }

    incrementQuizCount() {
      this.quiz_count_since_last_socratic += 1;
    }

    markDismissed() {
      this.last_dismissed_at = new Date().toISOString();
    }

    markOptOut() {
      this.opt_out = true;
    }

    markSocraticDone(clusterHash) {
      this.last_socratic_at = new Date().toISOString();
      this.quiz_count_since_last_socratic = 0;
      this.recent_cluster_hashes = (this.recent_cluster_hashes || []).slice();
      if (clusterHash && !this.recent_cluster_hashes.includes(clusterHash)) {
        this.recent_cluster_hashes.push(clusterHash);
      }
      // Keep only last 7 hashes (rough 24h cap)
      if (this.recent_cluster_hashes.length > 7) {
        this.recent_cluster_hashes = this.recent_cluster_hashes.slice(-7);
      }
    }
  }

  window.SocraticState = SocraticState;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SocraticState, DEFAULT_STATE };
  }
})();
