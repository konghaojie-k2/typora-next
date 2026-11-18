/**
 * Dynamic Inline SVG — 静态插图的 L1 交互 + L2 步进演示（Sprint 35）
 *
 * 约定（见 chapter-generation/references/inline-svg-spec.md §6.1）：
 * 图内逻辑部件用 <g data-part="id" data-label="短语" data-order="n"> 分组。
 * 运行时只在宿主机侧加 class、图例和步进条，不改 SVG 源码、不在图里跑脚本：
 *   - L1：hover 部件高亮 + 图例与图内双向联动
 *   - L2：上一步 / 下一步 / 播放 / 全部显示，按 data-order 逐段演示
 * 尊重 prefers-reduced-motion：开启减少动效时禁用自动播放。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SvgDynamic = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var STEP_INTERVAL_MS = 1400;

  // ============================================
  // 纯函数层
  // ============================================

  /** data-order：正整数才有效，否则回退到文档顺序 */
  function normalizeOrder(value, fallback) {
    var parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  /**
   * 从 DOM 节点数组收集 part（纯函数：只依赖 getAttribute）。
   * @returns {Array<{el: any, id: string, label: string, order: number}>}
   */
  function collectPartsFromList(nodes) {
    var list = Array.prototype.slice.call(nodes || []);
    var parts = [];
    list.forEach(function (el, docIndex) {
      if (!el || typeof el.getAttribute !== 'function') return;
      var id = String(el.getAttribute('data-part') || '').trim();
      if (!id) return;
      var label = String(el.getAttribute('data-label') || '').trim() || id;
      parts.push({
        el: el,
        id: id,
        label: label,
        order: normalizeOrder(el.getAttribute('data-order'), docIndex + 1),
        docIndex: docIndex
      });
    });
    parts.sort(function (a, b) {
      return a.order - b.order || a.docIndex - b.docIndex;
    });
    return parts;
  }

  /** 当前步骤下某个 part 的状态 */
  function stepState(index, current) {
    if (current < 0) return 'idle';
    if (index === current) return 'current';
    return index < current ? 'past' : 'future';
  }

  /** 减少动效时禁止自动播放 */
  function canAutoPlay(reducedMotion) {
    return !reducedMotion;
  }

  /** 步骤条进度文案：未开始时 0 / n */
  function formatProgress(current, total) {
    var shown = current < 0 ? 0 : current + 1;
    return shown + ' / ' + total;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  // ============================================
  // DOM 层
  // ============================================

  function createButton(text, className, title) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (className) button.className = className;
    if (title) button.title = title;
    return button;
  }

  function buildPanel(parts, ctx) {
    var panel = document.createElement('div');
    panel.className = 'svg-dynamic-panel';

    var legend = document.createElement('div');
    legend.className = 'svg-dynamic-legend';
    var legendButtons = parts.map(function (part, idx) {
      var button = createButton(part.label, 'svg-dynamic-legend-item', part.label);
      button.dataset.idx = String(idx);
      legend.appendChild(button);
      return button;
    });

    var controls = document.createElement('div');
    controls.className = 'svg-dynamic-controls';

    var prevBtn = createButton('‹ 上一步', 'svg-dynamic-control');
    var nextBtn = createButton('下一步 ›', 'svg-dynamic-control');
    var progressEl = document.createElement('span');
    progressEl.className = 'svg-dynamic-progress';
    progressEl.textContent = formatProgress(-1, parts.length);
    var labelEl = document.createElement('span');
    labelEl.className = 'svg-dynamic-label';
    var playBtn = createButton('▶ 播放', 'svg-dynamic-control');
    var resetBtn = createButton('全部显示', 'svg-dynamic-control');

    if (!canAutoPlay(ctx.reducedMotion)) {
      playBtn.disabled = true;
      playBtn.title = '系统已开启减少动效，自动播放已关闭';
    }

    controls.appendChild(prevBtn);
    controls.appendChild(nextBtn);
    controls.appendChild(progressEl);
    controls.appendChild(labelEl);
    controls.appendChild(playBtn);
    controls.appendChild(resetBtn);

    panel.appendChild(legend);
    panel.appendChild(controls);
    return { panel: panel, legendButtons: legendButtons, prevBtn: prevBtn, nextBtn: nextBtn, playBtn: playBtn, resetBtn: resetBtn, progressEl: progressEl, labelEl: labelEl };
  }

  function clearPartClasses(parts) {
    parts.forEach(function (part) {
      part.el.classList.remove('svg-part-active', 'svg-part-past', 'svg-part-future', 'svg-part-hover');
    });
  }

  function initSvg(svg, wrapper) {
    var nodes = Array.prototype.filter.call(
      svg.querySelectorAll('g[data-part]'),
      function (g) { return !g.closest('defs'); }
    );
    var parts = collectPartsFromList(nodes);
    if (parts.length < 2) return;

    wrapper.dataset.svgDynamic = '1';
    wrapper.classList.add('svg-dynamic');

    var reducedMotion = prefersReducedMotion();
    var ui = buildPanel(parts, { reducedMotion: reducedMotion });
    wrapper.appendChild(ui.panel);

    var state = { current: -1, timer: null };

    function syncLegend(activeIdx) {
      ui.legendButtons.forEach(function (button, idx) {
        button.classList.toggle('active', idx === activeIdx);
      });
    }

    function stopPlay() {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      ui.playBtn.textContent = '▶ 播放';
    }

    function applyStep(idx, keepPlaying) {
      if (!keepPlaying) stopPlay();
      state.current = idx;
      wrapper.classList.add('is-stepping');
      wrapper.classList.remove('is-hovering');
      clearPartClasses(parts);
      parts.forEach(function (part, partIdx) {
        var s = stepState(partIdx, idx);
        if (s === 'current') part.el.classList.add('svg-part-active');
        if (s === 'past') part.el.classList.add('svg-part-past');
        if (s === 'future') part.el.classList.add('svg-part-future');
      });
      ui.progressEl.textContent = formatProgress(idx, parts.length);
      ui.labelEl.textContent = parts[idx] ? parts[idx].label : '';
      syncLegend(idx);
    }

    function reset() {
      stopPlay();
      state.current = -1;
      wrapper.classList.remove('is-stepping', 'is-hovering');
      clearPartClasses(parts);
      ui.progressEl.textContent = formatProgress(-1, parts.length);
      ui.labelEl.textContent = '';
      syncLegend(-1);
    }

    function next(keepPlaying) {
      if (state.current >= parts.length - 1) return false;
      applyStep(state.current + 1, keepPlaying);
      return true;
    }

    function prev() {
      if (state.current <= 0) {
        if (state.current < 0) applyStep(0);
        return;
      }
      applyStep(state.current - 1);
    }

    function play() {
      if (!canAutoPlay(reducedMotion)) return;
      if (state.timer) {
        stopPlay();
        return;
      }
      if (state.current >= parts.length - 1) reset();
      ui.playBtn.textContent = '⏸ 暂停';
      next(true);
      state.timer = setInterval(function () {
        if (!next(true)) stopPlay();
      }, STEP_INTERVAL_MS);
    }

    ui.prevBtn.addEventListener('click', prev);
    ui.nextBtn.addEventListener('click', function () { next(false); });
    ui.playBtn.addEventListener('click', play);
    ui.resetBtn.addEventListener('click', reset);

    // L1：hover 图内部件高亮
    svg.addEventListener('mouseover', function (event) {
      if (wrapper.classList.contains('is-stepping')) return;
      var node = event.target.closest && event.target.closest('g[data-part]');
      if (!node) return;
      var idx = parts.findIndex(function (part) { return part.el === node; });
      if (idx < 0) return;
      clearPartClasses(parts);
      node.classList.add('svg-part-hover');
      wrapper.classList.add('is-hovering');
      syncLegend(idx);
    });
    svg.addEventListener('mouseout', function (event) {
      if (wrapper.classList.contains('is-stepping')) return;
      var to = event.relatedTarget;
      if (to && svg.contains(to)) return;
      clearPartClasses(parts);
      wrapper.classList.remove('is-hovering');
      syncLegend(state.current);
    });

    // L1：图例 <-> 图内联动；点击图例跳到该步
    ui.legendButtons.forEach(function (button, idx) {
      button.addEventListener('mouseenter', function () {
        if (wrapper.classList.contains('is-stepping')) return;
        clearPartClasses(parts);
        parts[idx].el.classList.add('svg-part-hover');
        wrapper.classList.add('is-hovering');
        syncLegend(idx);
      });
      button.addEventListener('mouseleave', function () {
        if (wrapper.classList.contains('is-stepping')) return;
        clearPartClasses(parts);
        wrapper.classList.remove('is-hovering');
        syncLegend(state.current);
      });
      button.addEventListener('click', function () {
        applyStep(idx);
      });
    });
  }

  /**
   * 扫描容器内的内联 SVG 插图并挂载交互（幂等，可在每次渲染后调用）。
   * @param {HTMLElement} container
   */
  function init(container) {
    if (!container) return;
    container.querySelectorAll('.svg-block-wrapper svg').forEach(function (svg) {
      var wrapper = svg.closest('.svg-block-wrapper');
      if (!wrapper || wrapper.dataset.svgDynamic === '1') return;
      initSvg(svg, wrapper);
    });
  }

  return {
    normalizeOrder: normalizeOrder,
    collectPartsFromList: collectPartsFromList,
    stepState: stepState,
    canAutoPlay: canAutoPlay,
    formatProgress: formatProgress,
    init: init
  };
});
