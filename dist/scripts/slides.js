/**
 * Typora Next - Slides Mode (v3)
 * Reveal.js integration with Rust-backed markdown rendering
 *
 * v3 (2026-07-26): 分页装箱不再在源码层猜行数，而是在 iframe 内
 * 真实排版后测量 DOM 高度（px）装箱——见 docs/plans/2026-07-26-slides-auto-split-design.md
 */

(function() {
  'use strict';

  // ============================================
  // 布局常量（与 Reveal.initialize 配置保持一致）
  // ============================================
  var SLIDE_W = 1280;
  var SLIDE_H = 720;
  var SLIDE_MARGIN = 0.06; // 纵向最大化（margin 同时控 H/V，横向留白由 CSS padding 单独补）

  function contentBox() {
    return {
      width: Math.round(SLIDE_W * (1 - 2 * SLIDE_MARGIN)),
      height: Math.round(SLIDE_H * (1 - 2 * SLIDE_MARGIN))
    };
  }

  // ============================================
  // 装箱核心（镜像 tests/shared/slides-pack-core.js，保持同步）
  // ============================================
  function packItems(items, availH) {
    var pages = [];
    var cur = [];
    var curH = 0;
    var currentH2 = null;
    var nextContinuedH2 = null;

    function flush() {
      if (cur.length > 0) {
        pages.push({ items: cur, continuedH2: nextContinuedH2 });
        cur = [];
        curH = 0;
        nextContinuedH2 = null;
      }
    }

    function headingChainNeed(idx) {
      var need = 0;
      var j = idx;
      while (j < items.length && items[j].isHeading) {
        need += items[j].height;
        j++;
      }
      if (j < items.length) need += items[j].height;
      return need;
    }

    var i = 0;
    while (i < items.length) {
      var item = items[i];

      if (item.isHeading && cur.length > 0) {
        var loneHeading = cur.length === 1 && cur[0].isHeading;
        if (!loneHeading && curH + headingChainNeed(i) > availH) {
          flush();
        }
      }

      // 放得下：直接装入
      if (curH + item.height <= availH) {
        cur.push(item);
        curH += item.height;
        if (item.h2Text) currentH2 = item.h2Text;
        i++;
        continue;
      }

      // 放不下：尝试拆分（空页时用整页高度，故翻页后会自然重试）
      if (item.split) {
        var parts = item.split(availH - curH);
        if (parts) {
          cur.push(parts[0]);
          flush();
          nextContinuedH2 = currentH2;
          items[i] = parts[1];
          continue;
        }
      }

      if (cur.length === 0) {
        // 空页 + 拆不动 + 超高 → 独占一页（设计允许的溢出）
        cur.push(item);
        curH += item.height;
        if (item.h2Text) currentH2 = item.h2Text;
        i++;
        continue;
      }

      // 非空页：翻页，循环用整页高度重试（修复：拆分不再因剩余空间小而被跳过）
      var continuedFrom = currentH2;
      flush();
      nextContinuedH2 = item.isHeading ? null : continuedFrom;
    }

    flush();
    return pages;
  }

  // ============================================
  // DOM 测量与拆分
  // ============================================
  var nodeHeights = new WeakMap(); // 拆分部分的高度估算依据

  function elementMargin(el) {
    var cs = getComputedStyle(el);
    return {
      top: parseFloat(cs.marginTop) || 0,
      bottom: parseFloat(cs.marginBottom) || 0
    };
  }

  function measureItems(div) {
    var items = [];
    var prevMarginBottom = 0;
    var children = Array.from(div.children);
    for (var k = 0; k < children.length; k++) {
      var el = children[k];
      var m = elementMargin(el);
      var gap = Math.max(0, m.top - prevMarginBottom); // margin 合并
      var h = gap + el.offsetHeight + m.bottom;
      prevMarginBottom = m.bottom;
      nodeHeights.set(el, h);

      var tag = el.tagName;
      var isHeading = /^H[1-6]$/.test(tag);
      items.push({
        height: h,
        isHeading: isHeading,
        h2Text: tag === 'H2' ? el.textContent.trim() : null,
        payload: el,
        split: splitFactory(el, tag)
      });
    }
    return items;
  }

  function subHeight(nodes) {
    var h = 0;
    for (var i = 0; i < nodes.length; i++) {
      h += nodeHeights.get(nodes[i]) || nodes[i].offsetHeight || 0;
    }
    return h;
  }

  function splitFactory(el, tag) {
    if (tag === 'PRE') return function(remainingH) { return splitPre(el, remainingH); };
    if (tag === 'TABLE') return function(remainingH) { return splitTable(el, remainingH); };
    if (tag === 'UL' || tag === 'OL') return function(remainingH) { return splitList(el, remainingH); };
    if (tag === 'BLOCKQUOTE') return function(remainingH) { return splitChildren(el, remainingH); };
    return null;
  }

  /** PRE 按行拆分（行高/字体/边距从原版缓存，克隆元素无 layout） */
  function splitPre(el, remainingH) {
    var lineH, fontSize, paddingTop, paddingBottom, borderTop, borderBottom;
    if (el._preMetrics) {
      lineH = el._preMetrics.lineH;
      paddingTop = el._preMetrics.paddingTop;
      paddingBottom = el._preMetrics.paddingBottom;
      borderTop = el._preMetrics.borderTop;
      borderBottom = el._preMetrics.borderBottom;
    } else {
      var code = el.querySelector('code') || el;
      var cs = getComputedStyle(code);
      lineH = parseFloat(cs.lineHeight) || ((parseFloat(cs.fontSize) || 20) * 1.4);
      fontSize = parseFloat(cs.fontSize);
      var ps = getComputedStyle(el);
      paddingTop = parseFloat(ps.paddingTop) || 0;
      paddingBottom = parseFloat(ps.paddingBottom) || 0;
      borderTop = parseFloat(ps.borderTopWidth) || 0;
      borderBottom = parseFloat(ps.borderBottomWidth) || 0;
      el._preMetrics = { lineH: lineH, paddingTop: paddingTop, paddingBottom: paddingBottom, borderTop: borderTop, borderBottom: borderBottom };
    }
    var chrome = paddingTop + paddingBottom + borderTop + borderBottom;
    var totalH = nodeHeights.get(el) || el.offsetHeight || 0;
    var linesFit = Math.floor((remainingH - chrome) / lineH);
    var codeEl = el.querySelector('code') || el;
    var lines = codeEl.textContent.replace(/\n$/, '').split('\n');
    if (linesFit < 1 || linesFit >= lines.length) return null;

    var part1 = el.cloneNode(false);
    var c1 = (codeEl !== el ? codeEl.cloneNode(false) : part1);
    c1.textContent = lines.slice(0, linesFit).join('\n');
    if (codeEl !== el) part1.appendChild(c1);

    var part2 = el.cloneNode(false);
    part2._preMetrics = el._preMetrics; // 递归拆分复用缓存
    var c2 = (codeEl !== el ? codeEl.cloneNode(false) : part2);
    c2.textContent = lines.slice(linesFit).join('\n');
    if (codeEl !== el) part2.appendChild(c2);

    var h1 = chrome + linesFit * lineH;
    return [
      { height: h1, isHeading: false, h2Text: null, payload: part1, split: null },
      { height: Math.max(totalH - h1, chrome + (lines.length - linesFit) * lineH), isHeading: false, h2Text: null, payload: part2, split: function(r) { return splitPre(part2, r); } }
    ];
  }

  /** TABLE 按行拆分（每片克隆表头，LI 高度缓存借 same trick 防 clone offsetHeight=0） */
  function splitTable(el, remainingH) {
    var thead = el.querySelector('thead');
    var headH = thead ? (nodeHeights.get(thead) || thead.offsetHeight) : 0;
    var rows = Array.from(el.querySelectorAll('tbody tr'));
    if (rows.length === 0) return null;

    var cached = el._rowHeights;
    if (!cached) {
      cached = rows.map(function(r) { return nodeHeights.get(r) || r.offsetHeight || 0; });
      el._rowHeights = cached;
    }

    var used = headH;
    var count = 0;
    while (count < cached.length && used + cached[count] <= remainingH) {
      used += cached[count];
      count++;
    }
    if (count === 0 || count >= cached.length) return null;

    function buildTable(subRows, heights) {
      var t = el.cloneNode(false);
      if (thead) t.appendChild(thead.cloneNode(true));
      var tb = document.createElement('tbody');
      subRows.forEach(function(r) { tb.appendChild(r.cloneNode(true)); });
      t.appendChild(tb);
      if (heights) t._rowHeights = heights;
      return t;
    }

    var margins = elementMargin(el).top + elementMargin(el).bottom;
    var part1Rows = rows.slice(0, count);
    var part2Rows = rows.slice(count);
    var part2Heights = cached.slice(count);
    return [
      { height: headH + cached.slice(0, count).reduce(function(s, h) { return s + h; }, 0) + margins, isHeading: false, h2Text: null, payload: buildTable(part1Rows), split: null },
      { height: headH + cached.slice(count).reduce(function(s, h) { return s + h; }, 0) + margins, isHeading: false, h2Text: null, payload: buildTable(part2Rows, part2Heights), split: function(r) { return splitTable(buildTable(part2Rows, part2Heights), r); } }
    ];
  }

  /** UL/OL 按条目拆分（OL 续片保持编号连续） */
  function splitList(el, remainingH) {
    // 优先用缓存的 LI 高度数组（克隆节点 offsetHeight=0，需从原版读）
    var cached = el._liHeights;
    var lis = Array.from(el.children).filter(function(n) { return n.tagName === 'LI'; });
    if (lis.length <= 1) return null;

    // 首调用：记录每个 LI 高度 + 缓存到元素属性（后续递归拆分复用）
    if (!cached) {
      cached = lis.map(function(li) { return nodeHeights.get(li) || li.offsetHeight || 0; });
      el._liHeights = cached;
    }

    var used = 0;
    var count = 0;
    while (count < cached.length && used + cached[count] <= remainingH) {
      used += cached[count];
      count++;
    }
    if (count === 0 || count >= cached.length) return null;

    var isOrdered = el.tagName === 'OL';
    var startNum = isOrdered ? (parseInt(el.getAttribute('start') || '1', 10) || 1) : 0;
    var margins = elementMargin(el).top + elementMargin(el).bottom;

    function buildList(subLis, start, heights) {
      var l = el.cloneNode(false);
      if (isOrdered && start != null) l.setAttribute('start', String(start));
      subLis.forEach(function(li) { l.appendChild(li.cloneNode(true)); });
      if (heights) l._liHeights = heights; // 传递高度给递归拆分
      return l;
    }

    var part1Lis = lis.slice(0, count);
    var part2Lis = lis.slice(count);
    var part2Heights = cached.slice(count);
    var part2List = buildList(part2Lis, startNum + count, part2Heights);
    return [
      { height: used + margins, isHeading: false, h2Text: null, payload: buildList(part1Lis, startNum), split: null },
      { height: cached.reduce(function(s, h) { return s + h; }, 0) - used + margins, isHeading: false, h2Text: null, payload: part2List, split: function(r) { return splitList(part2List, r); } }
    ];
  }

  /** BLOCKQUOTE 按子元素拆分（高度缓存防 clone offsetHeight=0） */
  function splitChildren(el, remainingH) {
    var kids = Array.from(el.children);
    if (kids.length <= 1) return null;

    var cached = el._childHeights;
    if (!cached) {
      cached = kids.map(function(k) { return nodeHeights.get(k) || k.offsetHeight || 0; });
      el._childHeights = cached;
    }

    var used = 0;
    var count = 0;
    while (count < cached.length && used + cached[count] <= remainingH) {
      used += cached[count];
      count++;
    }
    if (count === 0 || count >= cached.length) return null;

    function buildBox(subKids, heights) {
      var b = el.cloneNode(false);
      subKids.forEach(function(k) { b.appendChild(k.cloneNode(true)); });
      if (heights) b._childHeights = heights;
      return b;
    }

    var margins = elementMargin(el).top + elementMargin(el).bottom;
    var part1Kids = kids.slice(0, count);
    var part2Kids = kids.slice(count);
    var part2Heights = cached.slice(count);
    return [
      { height: cached.slice(0, count).reduce(function(s, h) { return s + h; }, 0) + margins, isHeading: false, h2Text: null, payload: buildBox(part1Kids), split: null },
      { height: cached.slice(count).reduce(function(s, h) { return s + h; }, 0) + margins, isHeading: false, h2Text: null, payload: buildBox(part2Kids, part2Heights), split: function(r) { return splitChildren(buildBox(part2Kids, part2Heights), r); } }
    ];
  }

  // ============================================
  // 测量容器流水线
  // ============================================
  function createMeasureDiv() {
    var box = contentBox();
    var div = document.createElement('div');
    div.className = 'slides-measure';
    // 测量容器宽度与 section 对齐（含 padding），确保装箱高度准确
    div.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0;'
      + 'width:' + box.width + 'px;'
      + 'padding-left:2%;padding-right:2%;'
      + 'box-sizing:border-box;';
    document.getElementById('slidesContainer').appendChild(div);
    return div;
  }

  function waitForImages(div, timeoutMs) {
    var imgs = Array.from(div.querySelectorAll('img'));
    return Promise.all(imgs.map(function(img) {
      if (img.complete) return Promise.resolve();
      return Promise.race([
        new Promise(function(res) {
          img.addEventListener('load', res, { once: true });
          img.addEventListener('error', res, { once: true });
        }),
        new Promise(function(res) { setTimeout(res, timeoutMs || 1500); })
      ]);
    }));
  }

  /**
   * GFM Alerts styling: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
   * Mirrors main.js initGFMAlerts（主视图同款渲染，否则幻灯片里只显示原始 [!NOTE] 文本）。
   */
  function styleGfmAlerts(container) {
    var icons = {
      'NOTE': 'ℹ️',
      'TIP': '💡',
      'IMPORTANT': '❗',
      'WARNING': '⚠️',
      'CAUTION': '🔥'
    };

    var blockquotes = container.querySelectorAll('blockquote');
    for (var i = 0; i < blockquotes.length; i++) {
      var bq = blockquotes[i];
      var firstP = bq.querySelector('p');
      if (!firstP) continue;

      var text = firstP.textContent.trim();
      var alertMatch = text.match(/^\[\!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (!alertMatch) continue;

      var alertType = alertMatch[1].toUpperCase();
      bq.classList.add('gfm-alert', 'gfm-alert-' + alertType.toLowerCase());

      firstP.textContent = firstP.textContent.replace(alertMatch[0], '').trim();

      var iconSpan = document.createElement('span');
      iconSpan.className = 'gfm-alert-icon';
      iconSpan.textContent = icons[alertType] || 'ℹ️';
      firstP.insertBefore(iconSpan, firstP.firstChild);

      if (!firstP.textContent.trim()) {
        firstP.remove();
      }
    }
  }

  /**
   * 渲染并测量一个内容单元，返回分页后的节点数组（每页一个节点数组）。
   */
  async function measureAndPack(unitHtml, baseDir, filePath) {
    var div = createMeasureDiv();
    div.innerHTML = unitHtml;

    // 1. 注释属性（fragment / .slide）
    processFragments(div);

    // 1.5 GFM alerts（与主视图一致的渲染）
    styleGfmAlerts(div);

    // 2. 图片路径（WikiLink / 相对路径）
    processWikiLinkImages(div, baseDir);
    processStandardImages(div, baseDir, filePath);

    // 3. KaTeX（影响高度，必须在测量前）
    if (typeof renderMathInElement !== 'undefined') {
      try {
        renderMathInElement(div, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      } catch (err) {
        console.error('KaTeX render failed:', err);
      }
    }

    // 4. Mermaid（异步渲染完成后再测量）
    await renderMermaidBlocks(div);

    // 5. 图片加载完成（高度才可靠）
    await waitForImages(div);

    // 6. 测量 + 装箱
    var items = measureItems(div);
    var availH = contentBox().height;
    var pages = packItems(items, availH);

    // 7. 物化：把节点从测量容器移出（随后容器销毁）
    var result = pages.map(function(page) {
      var nodes = [];
      if (page.continuedH2) {
        var h = document.createElement('h2');
        h.textContent = page.continuedH2 + '（续）';
        nodes.push(h);
      }
      page.items.forEach(function(item) { nodes.push(item.payload); });
      return nodes;
    });

    div.parentNode.removeChild(div);
    return result;
  }

  // ============================================
  // 初始化
  // ============================================
  var revealReady = false;

  async function doInit() {
    var container = document.getElementById('slidesContainer');
    container.innerHTML = '';

    var groups = window.__slides_groups || [];
    var baseDir = window.__slides_baseDir || '';
    var filePath = window.__slides_filePath || '';

    if (groups.length === 0) {
      container.innerHTML = '<section><h1>无内容</h1></section>';
      return;
    }

    if (typeof Reveal === 'undefined') {
      container.innerHTML = '<section><h1>Reveal.js 未加载</h1><p>请检查控制台</p></section>';
      return;
    }

    try {
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var hSec = document.createElement('section');

        if (group.cover) {
          var cov = document.createElement('section');
          cov.innerHTML = group.cover;
          hSec.appendChild(cov);
        }

        for (var u = 0; u < group.units.length; u++) {
          var pages = await measureAndPack(group.units[u], baseDir, filePath);
          for (var p = 0; p < pages.length; p++) {
            var sec = document.createElement('section');
            pages[p].forEach(function(n) { sec.appendChild(n); });
            hSec.appendChild(sec);
          }
        }

        // 空组保底（如章节只有封面）
        if (hSec.children.length === 0) {
          hSec.appendChild(document.createElement('section'));
        }
        container.appendChild(hSec);
      }

      if (revealReady && Reveal.isReady && Reveal.isReady()) {
        Reveal.destroy();
      }
      Reveal.initialize({
        width: SLIDE_W,
        height: SLIDE_H,
        margin: SLIDE_MARGIN,
        minScale: 0.2,
        maxScale: 2.0,
        transition: 'slide',
        backgroundTransition: 'fade',
        hash: true,
        slideNumber: 'c/t',
        showSlideNumber: 'all',
        controls: true,
        progress: true,
        center: false,
        touch: true,
        keyboard: { 27: null },
        overview: true
      });
      revealReady = true;

      // Prism 在最终 section 上高亮（拆分后的代码块也能正确着色）
      highlightCodeBlocks(container);
    } catch (err) {
      console.error('[slides] init failed:', err);
      container.innerHTML = '<section><h1>初始化失败</h1><p>' + err.message + '</p></section>';
    }
  }

  function highlightCodeBlocks(container) {
    if (typeof Prism === 'undefined') return;
    var codeBlocks = container.querySelectorAll('pre code[class*="language-"]');
    for (var i = 0; i < codeBlocks.length; i++) {
      var code = codeBlocks[i];
      var cls = code.className || '';
      var langMatch = cls.match(/language-(\w+)/);
      var language = langMatch ? langMatch[1].toLowerCase() : null;
      if (language && language !== 'mermaid') {
        var pre = code.parentElement;
        if (pre) pre.setAttribute('data-language', language);
        try {
          Prism.highlightElement(code);
        } catch (err) {
          console.error('Prism highlight failed:', err);
        }
      }
    }
  }

  /**
   * Process WikiLink images: ![[image.png]]
   * Mirrors main.js initObsidianEmbeds path resolution logic.
   */
  function processWikiLinkImages(container, baseDir) {
    var embedRegex = /!\[\[([^\]]+)\]\]/g;
    var imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    var convertFileSrc = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc;

    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(function(node) {
      var text = node.textContent;
      var match;
      embedRegex.lastIndex = 0;
      var replacements = [];

      while ((match = embedRegex.exec(text)) !== null) {
        var target = match[1].trim();
        var ext = target.split('.').pop().toLowerCase();
        var isImage = imageExtensions.indexOf(ext) !== -1;

        if (isImage) {
          var resolvedPath = target;
          if (baseDir) {
            var baseParts = baseDir.replace(/\\/g, '/').split('/');
            var targetParts = target.replace(/\\/g, '/').split('/');

            var overlapIndex = -1;
            for (var i = baseParts.length - 1; i >= 0; i--) {
              if (baseParts[i] === targetParts[0]) {
                var matchLen = 0;
                for (var j = 0; j < targetParts.length && i + j < baseParts.length; j++) {
                  if (baseParts[i + j] === targetParts[j]) {
                    matchLen++;
                  } else {
                    break;
                  }
                }
                if (matchLen > 0) {
                  overlapIndex = i;
                  break;
                }
              }
            }

            if (overlapIndex >= 0) {
              var vaultRoot = baseParts.slice(0, overlapIndex).join('/');
              resolvedPath = vaultRoot + '/' + target;
            } else {
              resolvedPath = baseDir + '/' + target;
            }
          }

          var finalSrc = convertFileSrc ? convertFileSrc(resolvedPath) : resolvedPath;
          if (finalSrc && finalSrc.includes('%25')) {
            finalSrc = decodeURIComponent(finalSrc);
          }

          var imgWrapper = document.createElement('div');
          imgWrapper.className = 'obsidian-embed obsidian-image-embed';

          var img = document.createElement('img');
          img.alt = target.split('/').pop().split('\\').pop();
          img.className = 'obsidian-embed-image';
          img.src = finalSrc;
          img.style.maxWidth = '100%';
          img.style.maxHeight = '60vh';
          img.style.objectFit = 'contain';

          img.onerror = function() {
            img.alt = '图片加载失败: ' + target;
            img.style.border = '1px dashed #f44';
          };

          imgWrapper.appendChild(img);
          replacements.push({ fullMatch: match[0], element: imgWrapper });
        }
      }

      if (replacements.length > 0) {
        var parent = node.parentNode;
        var remaining = text;
        replacements.forEach(function(r) {
          var idx = remaining.indexOf(r.fullMatch);
          if (idx !== -1) {
            var before = remaining.substring(0, idx);
            var after = remaining.substring(idx + r.fullMatch.length);
            if (before) parent.insertBefore(document.createTextNode(before), node);
            parent.insertBefore(r.element, node);
            remaining = after;
          }
        });
        if (remaining) parent.insertBefore(document.createTextNode(remaining), node);
        parent.removeChild(node);
      }
    });
  }

  /**
   * Process standard Markdown images: ![alt](path) - already rendered as <img>
   * Convert relative paths to Tauri convertFileSrc for local file access.
   */
  function processStandardImages(container, baseDir, filePath) {
    var convertFileSrc = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc;
    if (!convertFileSrc) return;

    var imgs = container.querySelectorAll('img');
    var mdDir = filePath ? filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : baseDir;

    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var src = img.getAttribute('src');
      if (!src) continue;

      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue;
      if (src.startsWith('asset://') || src.startsWith('tauri://')) continue;

      var resolvedPath;
      if (src.startsWith('/') || src.match(/^[A-Za-z]:\\/)) {
        resolvedPath = src;
      } else {
        if (mdDir) {
          resolvedPath = mdDir + '/' + src;
        } else if (baseDir) {
          resolvedPath = baseDir + '/' + src;
        } else {
          resolvedPath = src;
        }
      }

      resolvedPath = resolvedPath.replace(/\\/g, '/');

      var finalSrc = convertFileSrc(resolvedPath);
      if (finalSrc && finalSrc.includes('%25')) {
        finalSrc = decodeURIComponent(finalSrc);
      }

      img.src = finalSrc;

      img.onerror = function() {
        img.alt = '图片加载失败: ' + src;
        img.style.border = '1px dashed #f44';
      };
    }
  }

  /**
   * Mermaid 渲染（Promise 版）：渲染容器内所有 mermaid 块，完成后 resolve。
   * 保留 v2 的 SVG 后处理（字号/foreignObject/暗色边线）。
   */
  function renderMermaidBlocks(container) {
    if (typeof mermaid === 'undefined') return Promise.resolve();

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        themeVariables: {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", Roboto, sans-serif',
          fontSize: '16px',
          // 暗底可读配色：节点深蓝灰填充 + 亮边 + 浅字（替代硬编码白色补丁）
          primaryColor: '#33415c',
          primaryTextColor: '#e2e8f0',
          primaryBorderColor: '#60a5fa',
          lineColor: '#cbd5e1',
          secondaryColor: '#2d3748',
          tertiaryColor: '#1f2937',
          classText: '#e2e8f0'
        }
      });
    } catch (err) {
      console.error('Mermaid setup failed:', err);
      return Promise.resolve();
    }

    // <pre class="mermaid"> → <div class="mermaid">（pre 样式干扰 SVG 尺寸）
    var preMermaids = container.querySelectorAll('pre.mermaid');
    for (var k = 0; k < preMermaids.length; k++) {
      var pre = preMermaids[k];
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = pre.textContent;
      pre.parentNode.replaceChild(div, pre);
    }

    var blocks = container.querySelectorAll('.mermaid:not([data-mermaid-rendered])');
    var jobs = [];
    for (var j = 0; j < blocks.length; j++) {
      (function(block) {
        var code = block.textContent.trim();
        if (!code) return;
        var id = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        jobs.push(
          mermaid.render(id, code).then(function(result) {
            block.innerHTML = result.svg;
            block.setAttribute('data-mermaid-rendered', 'true');
            var svg = block.querySelector('svg');
            if (svg) postProcessMermaidSvg(svg);
          }).catch(function(err) {
            console.error('[slides] Mermaid render failed:', err);
            block.innerHTML = '<div style="color:#f44;padding:8px;border:1px dashed #f44;border-radius:4px;">' +
              '<strong>Mermaid 渲染失败</strong><br>' + String(err.message || err) + '</div>';
          })
        );
      })(blocks[j]);
    }
    return Promise.all(jobs);
  }

  /** Mermaid SVG 后处理：尺寸策略 + 字号修复（颜色由 themeVariables 接管） */
  function postProcessMermaidSvg(svg) {
    var vb = svg.getAttribute('viewBox') || '';
    var vbParts = vb.split(/\s+/).map(parseFloat);
    var vbW = vbParts[2] || 1;
    var vbH = vbParts[3] || 1;
    if (vbW > 0 && vbH > 0) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      // 尺寸策略：宽度一律适应最大宽度（小图放大、宽图收缩）；
      // 高度封顶可用高度，超长图等比缩放整页展示（preserveAspectRatio 留白不变形）
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.style.maxHeight = contentBox().height + 'px';
      svg.style.aspectRatio = vbW + ' / ' + vbH;
    }
    var texts = svg.querySelectorAll('text');
    for (var t = 0; t < texts.length; t++) {
      texts[t].setAttribute('font-size', '18px');
      texts[t].style.fontSize = '18px';
    }

    var foreignObjects = svg.querySelectorAll('foreignObject');
    for (var f = 0; f < foreignObjects.length; f++) {
      var fo = foreignObjects[f];
      fo.style.fontSize = '16px';
      var innerDiv = fo.querySelector('div');
      if (innerDiv) {
        innerDiv.style.fontSize = '16px';
        innerDiv.style.overflow = 'visible';
        var divW = parseFloat(innerDiv.style.width) || 0;
        var divH = parseFloat(innerDiv.style.height) || 0;
        if (divW > 0) innerDiv.style.width = (divW + 24) + 'px';
        if (divH > 0) innerDiv.style.height = (divH + 12) + 'px';
        var spans = innerDiv.querySelectorAll('span, p, b, i, strong, em');
        for (var s = 0; s < spans.length; s++) {
          spans[s].style.fontSize = '16px';
        }
      }
    }

    var nodeForeignObjects = svg.querySelectorAll('.node foreignObject');
    for (var f2 = 0; f2 < nodeForeignObjects.length; f2++) {
      var fo2 = nodeForeignObjects[f2];
      var oh = parseFloat(fo2.getAttribute('height')) || 0;
      var ow = parseFloat(fo2.getAttribute('width')) || 0;
      if (oh > 0) fo2.setAttribute('height', (oh + 12).toString());
      if (ow > 0) fo2.setAttribute('width', (ow + 24).toString());
    }

    var edgeLabels = svg.querySelectorAll('.edgeLabel foreignObject');
    for (var e = 0; e < edgeLabels.length; e++) {
      var fo3 = edgeLabels[e];
      var eh = parseFloat(fo3.getAttribute('height')) || 0;
      var ew = parseFloat(fo3.getAttribute('width')) || 0;
      if (eh > 0) fo3.setAttribute('height', (eh + 10).toString());
      if (ew > 0) fo3.setAttribute('width', (ew + 20).toString());
    }

    var rects = svg.querySelectorAll('.node rect');
    for (var r = 0; r < rects.length; r++) {
      var rect = rects[r];
      var rh = parseFloat(rect.getAttribute('height')) || 0;
      var rw = parseFloat(rect.getAttribute('width')) || 0;
      if (rh > 0) rect.setAttribute('height', (rh + 12).toString());
      if (rw > 0) rect.setAttribute('width', (rw + 24).toString());
    }
  }

  /**
   * Process HTML comments for reveal.js-style attributes.
   * <!-- .element: class="fragment" --> → adds class to previous element
   * <!-- .slide: data-background="#ff0000" --> → adds attr to parent section
   */
  function processFragments(container) {
    var commentsToRemove = [];
    var walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_COMMENT,
      null,
      false
    );

    while (walker.nextNode()) {
      var comment = walker.currentNode;
      var value = comment.nodeValue.trim();

      if (value.indexOf('.element:') === 0) {
        var attrString = value.substring('.element:'.length).trim();
        var prev = comment.previousElementSibling;
        if (!prev && comment.previousSibling) {
          var node = comment.previousSibling;
          while (node && node.nodeType !== Node.ELEMENT_NODE) {
            node = node.previousSibling;
          }
          prev = node;
        }
        if (prev) {
          var div = document.createElement('div');
          div.innerHTML = '<span ' + attrString + '></span>';
          var attrs = div.firstChild.attributes;
          for (var i = 0; i < attrs.length; i++) {
            var existing = prev.getAttribute(attrs[i].name);
            if (existing && attrs[i].name === 'class') {
              prev.setAttribute(attrs[i].name, existing + ' ' + attrs[i].value);
            } else {
              prev.setAttribute(attrs[i].name, attrs[i].value);
            }
          }
          commentsToRemove.push(comment);
        }
      }

      if (value.indexOf('.slide:') === 0) {
        var attrString2 = value.substring('.slide:'.length).trim();
        var section = comment.parentElement;
        while (section && section.tagName !== 'SECTION') {
          section = section.parentElement;
        }
        if (section) {
          var div2 = document.createElement('div');
          div2.innerHTML = '<span ' + attrString2 + '></span>';
          var attrs2 = div2.firstChild.attributes;
          for (var i2 = 0; i2 < attrs2.length; i2++) {
            var existing2 = section.getAttribute(attrs2[i2].name);
            if (existing2 && attrs2[i2].name === 'class') {
              section.setAttribute(attrs2[i2].name, existing2 + ' ' + attrs2[i2].value);
            } else {
              section.setAttribute(attrs2[i2].name, attrs2[i2].value);
            }
          }
          commentsToRemove.push(comment);
        }
      }
    }

    for (var i3 = 0; i3 < commentsToRemove.length; i3++) {
      var c = commentsToRemove[i3];
      if (c.parentNode) {
        c.parentNode.removeChild(c);
      }
    }
  }

  function waitForReveal(callback, retries) {
    retries = retries || 0;
    if (typeof Reveal !== 'undefined') {
      callback();
    } else if (retries < 300) {
      setTimeout(function() { waitForReveal(callback, retries + 1); }, 100);
    } else {
      var container = document.getElementById('slidesContainer');
      container.innerHTML = '<section><h1>加载超时</h1><p>Reveal.js 未能加载，请检查网络连接或文件路径。</p></section>';
    }
  }

  function init() {
    waitForReveal(function() { doInit(); });
  }

  window.__reloadSlides = function() {
    var container = document.getElementById('slidesContainer');
    if (container) {
      container.innerHTML = '';
      container.removeAttribute('style');
      container.className = 'slides';
    }
    if (revealReady && typeof Reveal !== 'undefined' && Reveal.isReady && Reveal.isReady()) {
      Reveal.destroy();
      revealReady = false;
    }
    init();
  };

  // Custom Esc handler: exit overview first, then close overlay
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (typeof Reveal !== 'undefined' && Reveal.isOverview && Reveal.isOverview()) {
        Reveal.toggleOverview();
        e.preventDefault();
        e.stopPropagation();
      } else {
        if (window.parent !== window) {
          window.parent.postMessage('close-slides', '*');
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
  }, true);

  // Only auto-init if content is already injected (e.g. direct page open).
  if (window.__slides_groups) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
