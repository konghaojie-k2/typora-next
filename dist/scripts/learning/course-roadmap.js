/**
 * Course Roadmap — 📍 下一站（Sprint 22）
 *
 * 课程完结后在知识图谱仪表盘下方展示「下一阶段学习方向」卡片，
 * 解决「用户没有系统性认知，不知道学完该学什么」的问题。
 *
 * 三态渲染：loading / error(+重试) / ready(卡片)。
 * 「换一批」与意向 chip（加大难度/平缓一些/换个领域）触发带排除约束的重生成；
 * 卡片点击通过 onSelectDirection 回调交给调用方（预填创建课程对话框，不自动提交）。
 *
 * 依赖注入（invoke / document）以便在无 jsdom 的单元测试中驱动。
 */

(function() {
  'use strict';

  const LEVEL_LABELS = { beginner: '入门', intermediate: '进阶', advanced: '高级' };

  const INTENT_CHIPS = [
    { id: 'harder', label: '🔥 加大难度' },
    { id: 'gentler', label: '🌱 平缓一些' },
    { id: 'different', label: '🔀 换个领域' }
  ];

  // 与 index.html #learningHours 的选项保持一致
  const HOURS_OPTIONS = [1, 2, 3, 5, 8, 16];

  /** 把任意小时数吸附到最近的可选档位（预填创建对话框用） */
  function snapHours(hours, options) {
    const opts = (Array.isArray(options) && options.length > 0) ? options : HOURS_OPTIONS;
    const h = Number(hours);
    if (!isFinite(h) || h <= 0) return opts[0];
    return opts.reduce((best, v) =>
      Math.abs(v - h) < Math.abs(best - h) ? v : best, opts[0]);
  }

  /**
   * 创建 📍 下一站 区块。
   * @param {Object} deps
   * @param {string} deps.projectPath - 课程项目路径
   * @param {Function} deps.invoke - Tauri invoke（注入以便测试）
   * @param {Document} [deps.document] - 文档对象（测试注入 mock）
   * @param {Function} [deps.onSelectDirection] - 卡片点击回调 ({goal, reason, level, hours})
   * @returns {HTMLElement} section 元素；element.roadmap = { getState, reload } 供测试/外部驱动
   */
  function createRoadmapSection(deps) {
    const doc = deps.document || (typeof document !== 'undefined' ? document : null);
    const invoke = deps.invoke;
    const projectPath = deps.projectPath;
    const onSelectDirection = deps.onSelectDirection || (() => {});

    let state = 'loading';   // loading | error | ready
    let roadmap = null;
    let errorMsg = '';
    let lastIntent = null;

    const section = doc.createElement('section');
    section.className = 'roadmap-section';

    // Header: 标题 + 重生成控件
    const header = doc.createElement('div');
    header.className = 'roadmap-header';
    const title = doc.createElement('span');
    title.className = 'roadmap-title';
    title.textContent = '📍 下一站';
    header.appendChild(title);

    const controls = doc.createElement('div');
    controls.className = 'roadmap-controls';

    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'roadmap-refresh';
    refreshBtn.setAttribute('data-action', 'reshuffle');
    refreshBtn.textContent = '🔁 换一批';
    refreshBtn.addEventListener('click', () => load('reshuffle'));
    controls.appendChild(refreshBtn);

    for (const chip of INTENT_CHIPS) {
      const btn = doc.createElement('button');
      btn.className = 'roadmap-chip';
      btn.setAttribute('data-intent', chip.id);
      btn.textContent = chip.label;
      btn.addEventListener('click', () => load(chip.id));
      controls.appendChild(btn);
    }
    header.appendChild(controls);
    section.appendChild(header);

    const body = doc.createElement('div');
    body.className = 'roadmap-body';
    section.appendChild(body);

    function render() {
      section.setAttribute('data-state', state);
      body.innerHTML = '';

      if (state === 'loading') {
        const el = doc.createElement('div');
        el.className = 'roadmap-status roadmap-loading';
        el.textContent = '⏳ 正在为你规划下一站…';
        body.appendChild(el);
        return;
      }

      if (state === 'error') {
        const el = doc.createElement('div');
        el.className = 'roadmap-status roadmap-error';
        el.textContent = '⚠️ 方向生成失败：' + errorMsg;
        body.appendChild(el);
        const retry = doc.createElement('button');
        retry.className = 'roadmap-retry';
        retry.setAttribute('data-action', 'retry');
        retry.textContent = '重试';
        retry.addEventListener('click', () => load(lastIntent));
        body.appendChild(retry);
        return;
      }

      // ready
      const dirs = (roadmap && Array.isArray(roadmap.directions)) ? roadmap.directions : [];
      const cards = doc.createElement('div');
      cards.className = 'roadmap-cards';
      for (const d of dirs) {
        const card = doc.createElement('button');
        card.className = 'roadmap-card';
        card.setAttribute('data-goal', d.goal || '');

        const goal = doc.createElement('div');
        goal.className = 'roadmap-card-goal';
        goal.textContent = d.goal || '';
        card.appendChild(goal);

        if (d.reason) {
          const reason = doc.createElement('div');
          reason.className = 'roadmap-card-reason';
          reason.textContent = d.reason;
          card.appendChild(reason);
        }

        const meta = doc.createElement('div');
        meta.className = 'roadmap-card-meta';
        const levelLabel = LEVEL_LABELS[d.level] || LEVEL_LABELS.intermediate;
        meta.textContent = `${levelLabel} · 约 ${d.hours || 3} 小时`;
        card.appendChild(meta);

        card.addEventListener('click', () => onSelectDirection(d));
        cards.appendChild(card);
      }
      body.appendChild(cards);
    }

    async function load(intent) {
      lastIntent = intent || null;
      state = 'loading';
      render();
      try {
        // intent=null + 有缓存时后端直接返回缓存；非 null 则带排除约束重生成
        // （'reshuffle' 是无指令换一批：后端只套用排除列表，prompt 不加意向）
        roadmap = await invoke('generate_roadmap', { projectPath, intent: intent || null });
        state = 'ready';
        errorMsg = '';
      } catch (e) {
        state = 'error';
        errorMsg = (e && e.message) ? e.message : String(e);
      }
      render();
    }

    section.roadmap = {
      getState: () => state,
      reload: (intent) => load(intent || null)
    };

    render();
    load(null); // 创建即加载（命中缓存则无 LLM 调用）
    return section;
  }

  const api = { LEVEL_LABELS, INTENT_CHIPS, HOURS_OPTIONS, snapHours, createRoadmapSection };

  if (typeof window !== 'undefined') window.CourseRoadmap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
