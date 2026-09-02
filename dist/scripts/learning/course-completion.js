/**
 * Course Completion - 课程完结状态的读侧派生（Sprint 16 起）
 *
 * 本模块是 course-summary.js 删除后的幸存者：幻灯片总结功能已移除（Sprint 22），
 * 但完结状态判定与复习入口展示决策仍被 project-resume / knowledge-graph-dashboard
 * 依赖，故独立成此小模块。
 *
 * 纯函数，Node.js 可测。
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') {
    global.window = {};
  }

  /**
   * 课程是否完结（读侧派生，Sprint 16）。
   * 完结 = project.json 顶层 course_status === 'completed'（写侧落盘）
   *   或全部章节状态为 completed/已完成（存量项目兼容，含 v1 chapter.status）。
   * @param {object} project - project.json 对象（{ chapters, chapters_status, course_status? }）
   */
  function isProjectCourseCompleted(project) {
    if (!project || typeof project !== 'object') return false;
    if (project.course_status === 'completed') return true;
    const chapters = Array.isArray(project.chapters) ? project.chapters : [];
    if (chapters.length === 0) return false;
    const cs = project.chapters_status || {};
    return chapters.every((ch) => {
      const s = (ch && ch.file && cs[ch.file]) || (ch && ch.status) || '';
      return s === 'completed' || s === '已完成';
    });
  }

  /**
   * Dashboard 复习入口展示决策（Sprint 16）。
   * 完结课程：入口常驻、不带计数徽标、不用提醒态样式（不再催复习）；
   * 未完结：仅有到期项时显示，且带计数 + 提醒态。
   * @returns {{visible: boolean, showCount: boolean, count: number, urgent: boolean}}
   */
  function getReviewEntrySpec(courseCompleted, dueCount) {
    const due = Number.isInteger(dueCount) && dueCount > 0 ? dueCount : 0;
    if (courseCompleted) {
      return { visible: true, showCount: false, count: 0, urgent: false };
    }
    if (due > 0) {
      return { visible: true, showCount: true, count: due, urgent: true };
    }
    return { visible: false, showCount: false, count: 0, urgent: false };
  }

  window.CourseCompletion = {
    isProjectCourseCompleted,
    getReviewEntrySpec
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isProjectCourseCompleted, getReviewEntrySpec };
  }
})();
