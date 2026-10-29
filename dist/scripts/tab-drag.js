/**
 * Tab Drag - pure logic for drag-to-reorder tabs
 *
 * Extracted from main.js to enable Node.js unit tests + BDD step defs.
 * Mirrors the IIFE + dual-export pattern of theme-manager.js.
 *
 * Design: commit-on-drop. main.js renderTabs() closes click/close handlers
 * over the loop index, so state.tabs must NOT be reordered mid-drag —
 * the drop handler composes these functions once, on mouseup:
 *
 *   shouldStartDrag(startX, x)  → 区分点击与拖拽（位移阈值）
 *   computeDropIndex(...)       → 指针位置 → 插入位（先删后插语义）
 *   reorderArray(tabs, from, to) → 顺序提交
 *   remapActiveIndex(active, from, to) → activeTab 跟随同一文件
 */
(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') {
    global.window = {};
  }

  /**
   * Pure: has the pointer moved far enough to count as a drag (not a click)?
   * Strictly greater than the threshold — a move of exactly `threshold` px
   * is still a click.
   */
  function shouldStartDrag(startX, currentX, threshold) {
    if (threshold === undefined) threshold = 4;
    return Math.abs(currentX - startX) > threshold;
  }

  /**
   * Pure: where would the dragged tab land if dropped at pointerX?
   *
   * @param {number[]} midpoints - center-X of each tab (viewport coords),
   *   in current DOM order. Snapshot once at drag start; safe because the
   *   DOM order never changes mid-drag (commit-on-drop).
   * @param {number} pointerX - current pointer X
   * @param {number} fromIndex - index of the dragged tab; its own midpoint
   *   is excluded from counting
   * @returns {number} insertion index AFTER removal (splice-out-then-insert
   *   semantics), clamped to [0, midpoints.length - 1]. Strict `<` on the
   *   midpoint comparison: crossing a neighbor's center flips past it.
   */
  function computeDropIndex(midpoints, pointerX, fromIndex) {
    let to = 0;
    for (let i = 0; i < midpoints.length; i++) {
      if (i !== fromIndex && midpoints[i] < pointerX) to++;
    }
    return Math.min(to, midpoints.length - 1);
  }

  /**
   * Pure: move arr[from] to position `to` (post-removal index).
   * Returns a NEW array; the input is never mutated.
   */
  function reorderArray(arr, from, to) {
    const next = arr.slice();
    const item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return next;
  }

  /**
   * Pure: keep the active FILE active after a reorder by remapping its index.
   *   active === from          → to   (the dragged tab itself stays active)
   *   from < active <= to      → -1   (dragged tab moved right across it)
   *   to <= active < from      → +1   (dragged tab moved left across it)
   *   otherwise (incl. -1, from === to) → unchanged
   */
  function remapActiveIndex(active, from, to) {
    if (active === from) return to;
    if (from < active && active <= to) return active - 1;
    if (to <= active && active < from) return active + 1;
    return active;
  }

  const api = {
    shouldStartDrag: shouldStartDrag,
    computeDropIndex: computeDropIndex,
    reorderArray: reorderArray,
    remapActiveIndex: remapActiveIndex
  };

  // Browser export
  if (typeof window !== 'undefined') {
    window.TabDrag = api;
  }

  // Node.js export (for unit + BDD tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
