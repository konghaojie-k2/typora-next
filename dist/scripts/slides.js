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
    var html = window.__slides_html || '';
    if (!html) {
      html = TEST_HTML;
    }

    var container = document.getElementById('slidesContainer');
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
        margin: 0.04,
        minScale: 0.2,
        maxScale: 2.0,
        transition: 'slide',
        backgroundTransition: 'fade',
        hash: true,
        slideNumber: 'c/t',
        showSlideNumber: 'all',
        controls: true,
        progress: true,
        center: true,
        touch: true,
        keyboard: { 27: null },
        overview: true
      });
      revealReady = true;
    } catch (err) {
      container.innerHTML = '<section><h1>Reveal.js 初始化失败</h1><p>' + err.message + '</p></section>';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
