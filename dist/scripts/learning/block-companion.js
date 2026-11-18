/**
 * Block Companion — 图表块级 AI 伴学（Sprint 34）
 *
 * 课程正文里的 SVG / 表格 / Mermaid 块右上角提供 ✨ 入口。
 * 源码不在 DOM 里（渲染后只剩 SVG/table/已渲染图表），因此点击时按
 * 「类型序号」从当前 tab 的 markdown 原文回抽：
 *   - SVG：复用 ExportSvgBlocks.extractInlineSvgBlocks（跳过代码围栏）
 *   - Mermaid：与 main.js findMermaidBlocks 同规则
 *   - 表格：本模块的 extractTableBlocks（跳过围栏，支持引用块）
 * 回抽失败时退回块的可读文本，保证入口永远可用。
 *
 * 纯函数层可在 Node 中测试；DOM 层只负责挂按钮与菜单。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : {});
  } else {
    root.BlockCompanion = factory(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  var TYPE_LABELS = { mermaid: 'Mermaid 图', table: '表格', svg: 'SVG 示意图' };
  var TRUNCATE_MARKER = '\n…（源码过长已截断）…\n';

  // ============================================
  // 纯函数层
  // ============================================

  function normalizeNewlines(markdown) {
    return String(markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /** 去掉行首引用标记（`> `），返回 { content, quoted } */
  function stripQuoteMarkers(line) {
    var match = line.match(/^[ \t]*(?:>[ \t]?)+/);
    if (!match) return { content: line, quoted: false };
    return { content: line.slice(match[0].length), quoted: true };
  }

  function dedent(text) {
    var lines = text.split('\n');
    var indents = lines
      .filter(function (line) { return line.trim().length > 0; })
      .map(function (line) { return (line.match(/^[ \t]*/) || [''])[0].length; });
    if (!indents.length) return text.trim();
    var minIndent = Math.min.apply(null, indents);
    return lines.map(function (line) { return line.slice(minIndent); }).join('\n');
  }

  function isDelimiterRow(line) {
    var trimmed = line.trim();
    if (trimmed.indexOf('|') < 0) return false;
    // 至少一个单元格 + 分隔符；允许有无外侧管道
    return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed);
  }

  function isTableRow(line) {
    return line.trim() !== '' && line.indexOf('|') >= 0;
  }

  /**
   * 抽取代码围栏之外的表格源码。支持引用块内表格与 CRLF。
   * @returns {Array<{text: string, startLine: number, endLine: number}>}
   */
  function extractTableBlocks(markdown) {
    var lines = normalizeNewlines(markdown).split('\n');
    var blocks = [];
    var inFence = false;
    var fenceChar = '';

    for (var i = 0; i < lines.length; i++) {
      var stripped = stripQuoteMarkers(lines[i]);
      var content = stripped.content;

      var fence = content.match(/^[ \t]{0,3}(```|~~~)/);
      if (fence) {
        var ch = fence[1][0];
        if (!inFence) { inFence = true; fenceChar = ch; }
        else if (ch === fenceChar) { inFence = false; }
        continue;
      }
      if (inFence) continue;
      // 缩进 ≥4 空格渲染为代码块，不能算表格
      if (!stripped.quoted && /^[ \t]{4,}/.test(content)) continue;

      if (!isTableRow(content)) continue;
      if (i + 1 >= lines.length) continue;
      var nextStripped = stripQuoteMarkers(lines[i + 1]);
      if (!isDelimiterRow(nextStripped.content)) continue;

      var end = i + 1;
      while (end + 1 < lines.length) {
        var rowStripped = stripQuoteMarkers(lines[end + 1]);
        if (!isTableRow(rowStripped.content)) break;
        end++;
      }

      var text = lines
        .slice(i, end + 1)
        .map(function (line) { return stripQuoteMarkers(line).content; })
        .join('\n');

      blocks.push({ text: text, startLine: i, endLine: end });
      i = end;
    }

    return blocks;
  }

  /**
   * 抽取 mermaid 围栏源码（``` / ~~~、mermaid/mmd、大小写、尾随 info）。
   * 规则与 main.js findMermaidBlocks 保持一致。
   */
  function extractMermaidBlocks(markdown) {
    var fenceRegex = /^[ \t]{0,3}(?:```|~~~)[ \t]*(?:mermaid|mmd)(?:[ \t]+[^\n]*)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]{0,3}(?:```|~~~)[ \t]*$/gim;
    var blocks = [];
    var match;
    while ((match = fenceRegex.exec(normalizeNewlines(markdown))) !== null) {
      blocks.push({ text: dedent(normalizeNewlines(match[1])).trim() });
    }
    return blocks;
  }

  function extractSvgBlocks(markdown) {
    if (root.ExportSvgBlocks && typeof root.ExportSvgBlocks.extractInlineSvgBlocks === 'function') {
      return root.ExportSvgBlocks.extractInlineSvgBlocks(markdown) || [];
    }
    if (typeof module !== 'undefined' && module.exports) {
      try {
        // eslint-disable-next-line global-require
        return require('../export-svg-blocks.js').extractInlineSvgBlocks(markdown) || [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  var DEFAULT_EXTRACTORS = {
    svg: extractSvgBlocks,
    table: extractTableBlocks,
    mermaid: extractMermaidBlocks
  };

  /**
   * 按类型 + 0 基序号从 markdown 回抽块源码；越界/未知类型返回 null。
   * extractors 可注入（测试用）。
   */
  function pickBlockSource(type, index, markdown, extractors) {
    var list = Object.assign({}, DEFAULT_EXTRACTORS, extractors || {});
    var extract = list[type];
    if (typeof extract !== 'function') return null;
    var blocks = extract(markdown);
    if (!Array.isArray(blocks) || index < 0 || index >= blocks.length) return null;
    return blocks[index] ? blocks[index].text : null;
  }

  /** 块标签：用于面板标题与 explain 的概念名 */
  function blockLabel(type, index) {
    return (TYPE_LABELS[type] || '内容块') + ' #' + (index + 1);
  }

  function chapterStem(path) {
    var name = String(path || '').replace(/\\/g, '/').split('/').pop() || '';
    return name.replace(/\.[^./\\]+$/, '') || 'chapter';
  }

  /** 块级稳定身份：block::{章节 stem}::{类型}::{1 基序号} */
  function buildBlockKey(chapterFile, type, index) {
    return 'block::' + chapterStem(chapterFile) + '::' + type + '::' + (index + 1);
  }

  /** 长源码截断：保留头 70% / 尾 30%，中间标注 */
  function truncateSource(text, maxChars) {
    var source = String(text == null ? '' : text);
    var limit = maxChars || 1500;
    if (source.length <= limit) return source;
    var budget = Math.max(0, limit - TRUNCATE_MARKER.length);
    var headLen = Math.floor(budget * 0.7);
    var tailLen = budget - headLen;
    return source.slice(0, headLen) + TRUNCATE_MARKER + (tailLen > 0 ? source.slice(-tailLen) : '');
  }

  // ============================================
  // DOM 层
  // ============================================

  var _state = null;
  var _menu = null;
  var _menuItem = null;

  function isInlineSvg(svg) {
    if (svg.closest('pre.mermaid')) return false;
    if (svg.closest('.katex')) return false;
    if (svg.closest('.download-btn')) return false;
    if (svg.parentElement && svg.parentElement.closest('svg')) return false;
    return true;
  }

  function mountTargets() {
    if (!_state || !_state.container) return [];
    var container = _state.container;
    var out = [];

    container.querySelectorAll('pre.mermaid').forEach(function (pre) {
      out.push({ mountEl: pre, blockEl: pre, type: 'mermaid' });
    });
    container.querySelectorAll('table').forEach(function (table) {
      out.push({
        mountEl: table.closest('.downloadable-wrapper') || table.parentElement,
        blockEl: table,
        type: 'table'
      });
    });
    container.querySelectorAll('svg').forEach(function (svg) {
      if (!isInlineSvg(svg)) return;
      out.push({
        mountEl: svg.closest('.svg-block-wrapper') || svg.parentElement,
        blockEl: svg,
        type: 'svg'
      });
    });
    return out;
  }

  function ordinalOf(item) {
    var container = _state.container;
    if (item.type === 'mermaid') {
      return Array.prototype.indexOf.call(container.querySelectorAll('pre.mermaid'), item.blockEl);
    }
    if (item.type === 'table') {
      return Array.prototype.indexOf.call(container.querySelectorAll('table'), item.blockEl);
    }
    var svgs = Array.prototype.filter.call(container.querySelectorAll('svg'), isInlineSvg);
    return svgs.indexOf(item.blockEl);
  }

  function findSectionTitle(el) {
    if (!_state || !_state.container) return '';
    var headings = _state.container.querySelectorAll('h1, h2, h3, h4');
    var title = '';
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      // eslint-disable-next-line no-bitwise
      if (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        title = (heading.textContent || '').trim();
      } else {
        break;
      }
    }
    return title;
  }

  function hideMenu() {
    if (_menu) _menu.style.display = 'none';
    _menuItem = null;
  }

  function ensureMenu() {
    if (_menu) return _menu;
    _menu = document.createElement('div');
    _menu.id = 'blockCompanionMenu';
    _menu.className = 'block-companion-menu';
    _menu.style.display = 'none';
    _menu.innerHTML = [
      '<button type="button" data-mode="explain">💡 给个解释</button>',
      '<button type="button" data-mode="example">📋 举个例子</button>',
      '<button type="button" data-mode="talk">💬 我有话说</button>',
      '<button type="button" data-mode="visualize">🖼️ 画个图</button>'
    ].join('');
    _menu.addEventListener('click', function (event) {
      var modeBtn = event.target.closest('[data-mode]');
      if (!modeBtn) return;
      event.stopPropagation();
      var item = _menuItem;
      var mode = modeBtn.dataset.mode;
      hideMenu();
      if (item) launch(item, mode);
    });
    document.body.appendChild(_menu);

    document.addEventListener('mousedown', function (event) {
      if (!_menu || _menu.style.display === 'none') return;
      if (_menu.contains(event.target) || event.target.closest('.block-companion-btn')) return;
      hideMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') hideMenu();
    });
    return _menu;
  }

  function openMenu(button, item) {
    var menu = ensureMenu();
    _menuItem = item;
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';

    var rect = button.getBoundingClientRect();
    var width = menu.offsetWidth || 176;
    var height = menu.offsetHeight || 150;
    var left = rect.right - width;
    var top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = 'visible';
  }

  function launch(item, mode) {
    if (!_state || !_state.enabled) return;
    var index = ordinalOf(item);
    if (index < 0) return;

    var source = pickBlockSource(item.type, index, _state.markdown);
    var fallback = (item.blockEl.textContent || '').trim();
    var payload = {
      blockType: item.type,
      blockIndex: index,
      label: blockLabel(item.type, index),
      source: source || fallback,
      sectionTitle: findSectionTitle(item.blockEl),
      surroundingText: fallback.slice(0, 400),
      mode: mode
    };

    if (window.LearningModeIntegration && window.LearningModeIntegration.openAICompanionForBlock) {
      window.LearningModeIntegration.openAICompanionForBlock(payload);
    }
  }

  /**
   * 在容器内挂载块级伴学入口。可在每次渲染后重复调用（幂等）。
   * @param {HTMLElement} container
   * @param {{enabled?: boolean, markdown?: string, chapterFile?: string}} opts
   */
  function init(container, opts) {
    opts = opts || {};
    _state = {
      container: container || null,
      enabled: opts.enabled !== false,
      markdown: String(opts.markdown || ''),
      chapterFile: String(opts.chapterFile || '')
    };
    if (!_state.container || !_state.enabled) return;

    mountTargets().forEach(function (item) {
      var mountEl = item.mountEl;
      if (!mountEl || !mountEl.dataset) return;
      if (mountEl.dataset.blockCompanion === '1') return;
      mountEl.dataset.blockCompanion = '1';
      if (!mountEl.style.position) mountEl.style.position = 'relative';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'block-companion-btn';
      button.textContent = '✨';
      button.title = 'AI 伴学';
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openMenu(button, item);
      });
      mountEl.appendChild(button);
    });
  }

  function destroy() {
    hideMenu();
    _state = null;
  }

  return {
    extractTableBlocks: extractTableBlocks,
    extractMermaidBlocks: extractMermaidBlocks,
    pickBlockSource: pickBlockSource,
    blockLabel: blockLabel,
    buildBlockKey: buildBlockKey,
    truncateSource: truncateSource,
    init: init,
    destroy: destroy
  };
});
