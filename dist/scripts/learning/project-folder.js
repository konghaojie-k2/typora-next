/**
 * Project Folder Manager
 * Handles .learning/project.json creation, loading, and updating
 *
 * Project structure on disk:
 *   <project_path>/
 *   └── .learning/
 *       ├── project.json    # Project metadata + chapter statuses
 *       └── chapters/       # Generated chapter files (future)
 */

(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') {
    global.window = {};
  }

  const fs = typeof require !== 'undefined' ? require('fs') : null;
  const path = typeof require !== 'undefined' ? require('path') : null;

  // ============================================
  // ProjectFolder (exported for testing)
  // ============================================
  class ProjectFolder {
    constructor(basePath) {
      this.basePath = basePath;
      this.learningDir = path ? path.join(basePath, '.learning') : basePath + '/.learning';
      this.jsonPath = path ? path.join(this.learningDir, 'project.json') : this.learningDir + '/project.json';
    }

    /**
     * Create .learning/project.json from outline
     * Does NOT overwrite if already exists
     * @param {object} outline - { chapters: [...], total_duration? }
     * @param {string} goal - Learning goal (used as project name)
     */
    create(outline, goal) {
      if (fs.existsSync(this.jsonPath)) {
        return; // Don't overwrite existing project
      }

      fs.mkdirSync(this.learningDir, { recursive: true });

      const project = {
        name: goal || outline.chapters[0]?.title || 'Learning Project',
        created: new Date().toISOString(),
        chapters: outline.chapters.map((ch, i) => ({
          title: ch.title || `第 ${i + 1} 章`,
          duration_minutes: ch.duration_minutes || 0,
          concepts: ch.concepts || [],
          status: 'not_generated',
          file: null
        })),
        total_duration: outline.total_duration ||
          outline.chapters.reduce((sum, ch) => sum + (ch.duration_minutes || 0), 0)
      };

      fs.writeFileSync(this.jsonPath, JSON.stringify(project, null, 2), 'utf-8');
    }

    /**
     * Load existing project.json
     * @returns {object|null}
     */
    load() {
      if (!fs.existsSync(this.jsonPath)) {
        return null;
      }
      try {
        return JSON.parse(fs.readFileSync(this.jsonPath, 'utf-8'));
      } catch (e) {
        return null;
      }
    }

    /**
     * Update a chapter's status and optional file path
     * @param {number} index
     * @param {string} status
     * @param {string|null} file
     */
    /**
     * NOTE: v2 schema — this writes to legacy chapters[i].status which is no longer
     * the canonical source of truth (use chapters_status map instead).
     * Kept for test compatibility; production code should use chapters_status.
     */
    updateChapterStatus(index, status, file) {
      const project = this.load();
      if (!project) throw new Error('No project found');
      if (index < 0 || index >= project.chapters.length) {
        throw new Error(`Invalid chapter index: ${index}`);
      }

      project.chapters[index].status = status;
      if (file !== undefined) {
        project.chapters[index].file = file;
      }

      fs.writeFileSync(this.jsonPath, JSON.stringify(project, null, 2), 'utf-8');
    }

    /**
     * Check if a learning project exists at this path
     * @returns {boolean}
     */
    exists() {
      return fs.existsSync(this.jsonPath);
    }

    /**
     * Get the project.json path
     * @returns {string}
     */
    getPath() {
      return this.jsonPath;
    }
  }

  // ============================================
  // Public API
  // ============================================
  window.LearningProjectFolder = ProjectFolder;

  // Export for Node.js testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProjectFolder };
  }
})();
