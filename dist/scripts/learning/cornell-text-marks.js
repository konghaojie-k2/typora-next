/**
 * Cornell Text Marks - 康奈尔划词痕迹
 *
 * IIFE + dual-export (theme-manager.js pattern) so Node.js unit tests and
 * BDD step defs can require the real module.
 *
 * Shows a purple WAVY underline on reading-pane text that has a Cornell
 * cue (划词问答), so learners can see which passages they already asked
 * about. Hover shows a Q&A summary tooltip; click scrolls the sidebar cue
 * card into view and flashes it.
 *
 * Position reality: explanations persist only `selected_text` (no offsets),
 * so marks are located by TEXT MATCHING via TreeWalker (same technique as
 * main.js findTextRange — main.js is an IIFE with no exports, hence the
 * ~60-line controlled duplication here). The locate strategy is injectable
 * (deps.locate) because mock DOMs have no TreeWalker/createRange.
 *
 * MVP constraints (by design):
 * - Only the FIRST occurrence of a repeated text is marked
 * - Text not found (content edited since) is skipped silently
 * - LRU-evicted cues leave stale marks until the next chapter render
 */
(function() {
  'use strict';

  var MARK_CLASS = 'cornell-cue-mark';
  var TOOLTIP_CLASS = 'cornell-cue-tooltip';
  // Never match text inside code / math / diagrams / existing marks
  // (selector set follows main.js:5499/5868 precedent).
  var EXCLUDED_SELECTOR = 'pre, code, .katex, .mermaid, .mermaid-error-wrapper, .' + MARK_CLASS;

  // ============================================
  // Pure helpers
  // ============================================
  function truncate(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /**
   * Build the tooltip view model for a cue.
   * cue: { term, qaHistory: [{q, a}] }
   */
  function buildTooltipModel(cue, maxLen) {
    maxLen = maxLen || 60;
    var qa = (cue && cue.qaHistory) || [];
    var first = qa[0] || {};
    return {
      selectedText: (cue && cue.term) || '',
      firstQ: truncate(first.q, 40),
      firstA: truncate(first.a, maxLen),
      rounds: qa.length
    };
  }

  function matchesExcluded(el) {
    var parts = EXCLUDED_SELECTOR.split(',');
    for (var i = 0; i < parts.length; i++) {
      var sel = parts[i].trim();
      if (sel.charAt(0) === '.') {
        if (el.classList && el.classList.contains(sel.slice(1))) return true;
      } else if (el.tagName && el.tagName.toLowerCase() === sel.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  /** True when the text node is NOT inside pre/code/katex/mermaid/marks. */
  function acceptsTextNode(node) {
    var p = node.parentElement || node.parentNode;
    while (p) {
      if (matchesExcluded(p)) return false;
      p = p.parentElement || p.parentNode;
    }
    return true;
  }

  // ============================================
  // Browser default locator (TreeWalker, mirrors
  // main.js findTextRange + highlightRange)
  // ============================================
  function defaultLocate(container, text) {
    if (typeof document === 'undefined' || !document.createTreeWalker) return null;
    var walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(n) {
          return acceptsTextNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) textNodes.push(node);

    var concat = '';
    var boundaries = [0];
    for (var i = 0; i < textNodes.length; i++) {
      concat += textNodes[i].textContent;
      boundaries.push(concat.length);
    }

    var idx = concat.indexOf(text);
    if (idx === -1) return null;

    var endIdx = idx + text.length;
    var startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    for (var j = 0; j < textNodes.length; j++) {
      if (idx >= boundaries[j] && idx < boundaries[j + 1]) {
        startNode = textNodes[j];
        startOffset = idx - boundaries[j];
      }
      if (endIdx > boundaries[j] && endIdx <= boundaries[j + 1]) {
        endNode = textNodes[j];
        endOffset = endIdx - boundaries[j];
      }
      if (startNode && endNode) break;
    }
    if (!startNode || !endNode) return null;

    var range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  /** Wrap a Range in mark spans (surroundContents + per-text-node fallback). */
  function wrapRange(range, cueId, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    function makeSpan() {
      var span = doc.createElement('span');
      span.className = MARK_CLASS;
      span.setAttribute('data-cue-id', cueId);
      return span;
    }

    var el = makeSpan();
    try {
      range.surroundContents(el);
      return el;
    } catch (e) {
      // Selection spans multiple block elements; wrap each text node individually
      var contents = range.extractContents();
      var walker = doc.createTreeWalker(contents, NodeFilter.SHOW_TEXT);
      var nodesToWrap = [];
      var node;
      while ((node = walker.nextNode())) nodesToWrap.push(node);

      var firstWrapper = null;
      for (var i = 0; i < nodesToWrap.length; i++) {
        var wrapper = makeSpan();
        wrapper.textContent = nodesToWrap[i].textContent;
        if (!firstWrapper) firstWrapper = wrapper;
        nodesToWrap[i].parentNode.replaceChild(wrapper, nodesToWrap[i]);
      }
      range.insertNode(contents);
      return firstWrapper;
    }
  }

  // ============================================
  // Mark injection / removal
  // ============================================

  /**
   * Inject a wavy-underline mark for one cue into the reading pane.
   * Idempotent per cue id. Returns true when a mark was added.
   * cue: { id, term }  deps.locate: (container, text) => Range | null
   */
  function injectCueMark(container, cue, deps) {
    if (!container || !cue || !cue.id || !cue.term) return false;
    if (container.querySelector('.' + MARK_CLASS + '[data-cue-id="' + cue.id + '"]')) {
      return false; // already marked
    }
    var locate = (deps && deps.locate) || defaultLocate;
    var range = locate(container, cue.term);
    if (!range) return false; // text edited away — skip silently
    var wrapped = wrapRange(range, cue.id, deps && deps.doc);
    return !!wrapped;
  }

  /** Inject marks for all cues. Returns the number of marks added. */
  function injectAllCueMarks(container, cues, deps) {
    var count = 0;
    (cues || []).forEach(function(cue) {
      if (injectCueMark(container, cue, deps)) count++;
    });
    return count;
  }

  /** Unwrap every mark span for cueId (text restored). Returns true if any. */
  function removeCueMark(container, cueId) {
    if (!container) return false;
    var marks = container.querySelectorAll('.' + MARK_CLASS + '[data-cue-id="' + cueId + '"]');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      m.replaceWith.apply(m, m.childNodes);
    }
    return marks.length > 0;
  }

  /** Unwrap all cue marks in the container. Returns the number removed. */
  function removeAllCueMarks(container) {
    if (!container) return 0;
    var marks = container.querySelectorAll('.' + MARK_CLASS);
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      m.replaceWith.apply(m, m.childNodes);
    }
    return marks.length;
  }

  // ============================================
  // Interactions (event delegation on the pane)
  // ============================================

  /**
   * Bind hover-tooltip + click-to-sidebar interactions on the reading pane.
   * The pane element survives chapter switches (only its innerHTML is
   * replaced), so one delegated binding covers all future marks.
   *
   * opts.getSidebarBody: () => Element   (resolved at click time — sidebar
   *   cards are re-rendered on every update, direct binding would go stale)
   * opts.getCue: (cueId) => cue          (for the tooltip model)
   * opts.doc: Document                   (injectable for tests)
   */
  function attachMarkInteractions(container, opts) {
    if (!container || container._cueMarksAttached) return;
    container._cueMarksAttached = true;

    var getSidebarBody = opts && opts.getSidebarBody;
    var getCue = opts && opts.getCue;
    var doc = (opts && opts.doc) || (typeof document !== 'undefined' ? document : null);

    var tooltip = null;
    function ensureTooltip() {
      if (tooltip || !doc) return tooltip;
      tooltip = doc.createElement('div');
      tooltip.className = TOOLTIP_CLASS;
      tooltip.style.display = 'none';
      doc.body.appendChild(tooltip);
      return tooltip;
    }

    function closestMark(node) {
      while (node && node !== container) {
        if (node.classList && node.classList.contains(MARK_CLASS)) return node;
        node = node.parentNode;
      }
      return null;
    }

    container.addEventListener('click', function(e) {
      var mark = closestMark(e.target);
      if (!mark) return;
      var cueId = mark.getAttribute('data-cue-id');
      var body = getSidebarBody && getSidebarBody();
      if (!body) return;
      var card = body.querySelector('.cornell-cue[data-cue-id="' + cueId + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Re-trigger the flash animation
      card.classList.remove('cue-flash');
      void card.offsetWidth;
      card.classList.add('cue-flash');
    });

    container.addEventListener('mouseover', function(e) {
      var mark = closestMark(e.target);
      if (!mark) return;
      var cue = getCue && getCue(mark.getAttribute('data-cue-id'));
      if (!cue) return;
      var tip = ensureTooltip();
      if (!tip) return;
      var model = buildTooltipModel(cue);

      tip.textContent = '';
      var lines = [
        '💬 ' + model.selectedText,
        model.firstQ ? 'Q: ' + model.firstQ : '',
        model.firstA ? 'A: ' + model.firstA : '',
        '共 ' + model.rounds + ' 轮问答 · 点击查看'
      ];
      lines.forEach(function(line, i) {
        if (!line) return;
        var div = doc.createElement('div');
        div.className = i === 0 ? TOOLTIP_CLASS + '-title' : TOOLTIP_CLASS + '-line';
        div.textContent = line;
        tip.appendChild(div);
      });

      if (mark.getBoundingClientRect) {
        var rect = mark.getBoundingClientRect();
        tip.style.left = rect.left + 'px';
        tip.style.top = (rect.bottom + 6) + 'px';
      }
      tip.style.display = 'block';
    });

    container.addEventListener('mouseout', function(e) {
      var mark = closestMark(e.target);
      if (!mark) return;
      if (tooltip) tooltip.style.display = 'none';
    });
  }

  // ============================================
  // Exports
  // ============================================
  var api = {
    MARK_CLASS: MARK_CLASS,
    TOOLTIP_CLASS: TOOLTIP_CLASS,
    EXCLUDED_SELECTOR: EXCLUDED_SELECTOR,
    buildTooltipModel: buildTooltipModel,
    acceptsTextNode: acceptsTextNode,
    injectCueMark: injectCueMark,
    injectAllCueMarks: injectAllCueMarks,
    removeCueMark: removeCueMark,
    removeAllCueMarks: removeAllCueMarks,
    attachMarkInteractions: attachMarkInteractions
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.CornellTextMarks = api;
  }
})();
