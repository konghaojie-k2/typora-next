/**
 * Typora Next - Slides Mode
 * Reveal.js integration with Rust-backed markdown rendering
 */

(function() {
  'use strict';

  var TEST_HTML = '<h1>Welcome to Typora Next Slides</h1>';
  var revealReady = false;

  /**
   * Split pre-rendered HTML by <hr> tags (which pulldown-cmark renders from ---).
   * Fallback for old behavior.
   */
  function splitHtmlIntoSlides(html) {
    var parts = html.split(/<hr\s*\/?>/gi);
    var slides = [];
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].trim();
      if (trimmed.length > 0) {
        slides.push(trimmed);
      }
    }
    return slides;
  }

  function doInit() {
    var container = document.getElementById('slidesContainer');

    // New: structured sections from main window (supports vertical slides)
    var sections = window.__slides_sections;
    if (sections && sections.length > 0) {
      container.innerHTML = '';
      for (var i = 0; i < sections.length; i++) {
        var section = sections[i];
        if (section.type === 'horizontal') {
          var sec = document.createElement('section');
          sec.innerHTML = section.html;
          container.appendChild(sec);
        } else if (section.type === 'vertical') {
          var sec = document.createElement('section');
          for (var j = 0; j < section.children.length; j++) {
            var childSec = document.createElement('section');
            childSec.innerHTML = section.children[j];
            sec.appendChild(childSec);
          }
          container.appendChild(sec);
        }
      }
    } else {
      // Fallback: old single-html behavior
      var html = window.__slides_html || '';
      if (!html) {
        html = TEST_HTML;
      }

      var slideParts;
      try {
        slideParts = splitHtmlIntoSlides(html);
      } catch (err) {
        container.innerHTML = '<section><h1>解析错误</h1><p>' + err.message + '</p></section>';
        return;
      }

      container.innerHTML = '';
      if (slideParts.length === 0) {
        container.innerHTML = '<section><h1>无内容</h1></section>';
        return;
      }

      for (var i = 0; i < slideParts.length; i++) {
        var section = document.createElement('section');
        section.innerHTML = slideParts[i];
        container.appendChild(section);
      }
    }

    if (typeof Reveal === 'undefined') {
      container.innerHTML = '<section><h1>Reveal.js 未加载</h1><p>请检查控制台</p></section>';
      return;
    }

    try {
      if (revealReady && Reveal.isReady && Reveal.isReady()) {
        Reveal.destroy();
      }
      Reveal.initialize({
        width: 1280,
        height: 720,
        margin: 0.06,
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

      // Post-process: math, code highlighting, mermaid diagrams, fragments
      postProcessSlides();
    } catch (err) {
      container.innerHTML = '<section><h1>Reveal.js 初始化失败</h1><p>' + err.message + '</p></section>';
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
          // Resolve path (same logic as main.js initObsidianEmbeds)
          var resolvedPath = target;
          if (baseDir) {
            var baseParts = baseDir.replace(/\\/g, '/').split('/');
            var targetParts = target.replace(/\\/g, '/').split('/');

            // Check if target's first segment matches any part of baseDir
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

          // Use Tauri convertFileSrc for local file access
          var finalSrc = convertFileSrc ? convertFileSrc(resolvedPath) : resolvedPath;
          // Fix double-encoding issue (%25 indicates % was encoded again)
          if (finalSrc && finalSrc.includes('%25')) {
            finalSrc = decodeURIComponent(finalSrc);
          }
          console.log('[slides WikiLink] target:', target, 'resolvedPath:', resolvedPath, 'finalSrc:', finalSrc);

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
   * Post-process slide content: KaTeX math, Prism code highlighting, Mermaid diagrams, fragments, WikiLink images.
   */
  function postProcessSlides() {
    var container = document.getElementById('slidesContainer');
    if (!container) return;

    // 1. Process fragment comments: <!-- .element: class="fragment" -->
    processFragments(container);

    // 2. WikiLink images: ![[image.png]]
    var baseDir = window.__slides_baseDir || '';
    processWikiLinkImages(container, baseDir);

    // 3. KaTeX math rendering
    if (typeof renderMathInElement !== 'undefined') {
      try {
        renderMathInElement(container, {
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

    // 4. Prism code highlighting (skip mermaid blocks)
    if (typeof Prism !== 'undefined') {
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

    // 5. Mermaid diagrams
    if (typeof mermaid !== 'undefined') {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose'
        });
        var mermaidBlocks = container.querySelectorAll('.mermaid');
        if (mermaidBlocks.length > 0) {
          mermaid.init(undefined, mermaidBlocks);
        }
      } catch (err) {
        console.error('Mermaid init failed:', err);
      }
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

      // .element: class="fragment" data-fragment-index="1"
      if (value.indexOf('.element:') === 0) {
        var attrString = value.substring('.element:'.length).trim();
        var prev = comment.previousElementSibling;
        if (!prev && comment.previousSibling) {
          // previousSibling might be a text node; find nearest element before it
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

      // .slide: data-background="#ff0000"
      if (value.indexOf('.slide:') === 0) {
        var attrString = value.substring('.slide:'.length).trim();
        var section = comment.parentElement;
        while (section && section.tagName !== 'SECTION') {
          section = section.parentElement;
        }
        if (section) {
          var div = document.createElement('div');
          div.innerHTML = '<span ' + attrString + '></span>';
          var attrs = div.firstChild.attributes;
          for (var i = 0; i < attrs.length; i++) {
            var existing = section.getAttribute(attrs[i].name);
            if (existing && attrs[i].name === 'class') {
              section.setAttribute(attrs[i].name, existing + ' ' + attrs[i].value);
            } else {
              section.setAttribute(attrs[i].name, attrs[i].value);
            }
          }
          commentsToRemove.push(comment);
        }
      }
    }

    for (var i = 0; i < commentsToRemove.length; i++) {
      var c = commentsToRemove[i];
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
    waitForReveal(doInit);
  }

  window.__reloadSlides = function() {
    // Fully reset container DOM to prevent Reveal.js state corruption on re-init
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
  // When opened via iframe, parent window calls __reloadSlides() after injecting
  // __slides_sections, so we skip init() here to avoid a flash of placeholder
  // content and duplicate Reveal.initialize() calls that corrupt slide counting.
  if (window.__slides_sections || window.__slides_html) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
