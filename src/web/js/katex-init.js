/**
 * KaTeX Initialization
 * Enhanced math rendering with auto-detection and error handling
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    // Delimiters for math detection
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false }
    ],

    // KaTeX options
    katexOptions: {
      throwOnError: false,
      displayMode: false,
      output: 'html',
      strict: 'warn',
      trust: false,
      maxSize: 500,
      maxExpand: 100
    },

    // Custom error message
    errorMessage: 'Math rendering error',

    // Enable debug mode
    debug: false
  };

  // Store original LaTeX for copy functionality
  const latexStore = new WeakMap();

  /**
   * Initialize KaTeX
   */
  function initKaTeX() {
    if (typeof katex === 'undefined') {
      console.warn('KaTeX not loaded');
      return;
    }

    // Render all math elements
    renderAllMath();

    // Observe for dynamic content
    observeMathElements();
  }

  /**
   * Render all math elements in the document
   */
  function renderAllMath() {
    // Use auto-render extension if available
    if (typeof renderMathInElement !== 'undefined') {
      const contentAreas = document.querySelectorAll('.markdown-body, article, .content, main');
      contentAreas.forEach(area => {
        renderMathInElement(area, {
          delimiters: CONFIG.delimiters,
          katexOptions: CONFIG.katexOptions,
          preProcess: preProcessLatex,
          postProcess: postProcessLatex
        });
      });

      if (CONFIG.debug) {
        console.log('KaTeX: Auto-render completed');
      }
    } else {
      // Manual rendering fallback
      renderMathManually();
    }
  }

  /**
   * Pre-process LaTeX before rendering
   */
  function preProcessLatex(latex) {
    // Store original LaTeX
    return latex.trim();
  }

  /**
   * Post-process after rendering
   */
  function postProcessLatex(element, latex) {
    // Store original LaTeX for potential copy
    latexStore.set(element, latex);

    // Add animation class
    element.classList.add('math-rendering');
    setTimeout(() => element.classList.remove('math-rendering'), 300);
  }

  /**
   * Manual math rendering (fallback)
   */
  function renderMathManually() {
    // Find and render display math ($$...$$)
    renderDisplayMath();

    // Find and render inline math ($...$)
    renderInlineMath();
  }

  /**
   * Render display math
   */
  function renderDisplayMath() {
    const displayPattern = /\$\$([^$]+)\$\$|\\\[([\s\S]+?)\\\]/g;

    document.body.innerHTML = document.body.innerHTML.replace(displayPattern, (match, p1, p2) => {
      const latex = (p1 || p2).trim();
      try {
        const html = katex.renderToString(latex, {
          ...CONFIG.katexOptions,
          displayMode: true
        });
        return `<div class="katex-display">${html}</div>`;
      } catch (e) {
        console.error('KaTeX display math error:', e);
        return `<span class="katex-error" title="${escapeHtml(e.message)}">${escapeHtml(latex)}</span>`;
      }
    });
  }

  /**
   * Render inline math
   */
  function renderInlineMath() {
    const inlinePattern = /\$([^$\n]+)\$|\\\(([\s\S]+?)\\\)/g;

    document.body.innerHTML = document.body.innerHTML.replace(inlinePattern, (match, p1, p2) => {
      const latex = (p1 || p2).trim();
      try {
        const html = katex.renderToString(latex, CONFIG.katexOptions);
        return html;
      } catch (e) {
        console.error('KaTeX inline math error:', e);
        return `<span class="katex-error" title="${escapeHtml(e.message)}">${escapeHtml(latex)}</span>`;
      }
    });
  }

  /**
   * Render specific element
   */
  function renderElement(element) {
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(element, {
        delimiters: CONFIG.delimiters,
        katexOptions: CONFIG.katexOptions
      });
    }
  }

  /**
   * Observe DOM for new math elements
   */
  function observeMathElements() {
    const observer = new MutationObserver(mutations => {
      let shouldRender = false;

      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if node contains math delimiters
            const text = node.textContent || '';
            if (text.includes('$') || text.includes('\\[') || text.includes('\\(')) {
              shouldRender = true;
            }
          }
        });
      });

      if (shouldRender) {
        // Debounce rendering
        clearTimeout(observeMathElements.timeout);
        observeMathElements.timeout = setTimeout(renderAllMath, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Copy LaTeX source
   */
  function copyLatex(element) {
    const latex = latexStore.get(element);
    if (latex) {
      return navigator.clipboard.writeText(latex);
    }
    return Promise.reject(new Error('No LaTeX source found'));
  }

  /**
   * Show LaTeX source
   */
  function showLatexSource(element) {
    const latex = latexStore.get(element);
    if (latex) {
      const sourceDisplay = document.createElement('span');
      sourceDisplay.className = 'math-source';
      sourceDisplay.textContent = latex;

      element.style.display = 'none';
      element.parentNode.insertBefore(sourceDisplay, element.nextSibling);

      sourceDisplay.addEventListener('click', () => {
        sourceDisplay.remove();
        element.style.display = '';
      });
    }
  }

  /**
   * Check if text contains math
   */
  function containsMath(text) {
    return /\$\$?[^$]+\$\$?|\\\([^)]+\\\)|\\\[[^\]]+\\\]/.test(text);
  }

  /**
   * Re-render all math
   */
  function reRender() {
    renderAllMath();
  }

  /**
   * Create numbered equation
   */
  function createNumberedEquation(latex, number) {
    const container = document.createElement('div');
    container.className = 'equation-container';

    const equation = document.createElement('div');
    try {
      katex.render(latex, equation, {
        ...CONFIG.katexOptions,
        displayMode: true
      });
    } catch (e) {
      equation.innerHTML = `<span class="katex-error">${escapeHtml(latex)}</span>`;
    }

    const numSpan = document.createElement('span');
    numSpan.className = 'equation-number';
    numSpan.textContent = `(${number})`;

    container.appendChild(equation);
    container.appendChild(numSpan);

    return container;
  }

  /**
   * Create aligned equations block
   */
  function createAlignedEquations(latexArray) {
    const container = document.createElement('div');
    container.className = 'align-container';

    latexArray.forEach(latex => {
      const line = document.createElement('div');
      try {
        katex.render(latex, line, {
          ...CONFIG.katexOptions,
          displayMode: true
        });
      } catch (e) {
        line.innerHTML = `<span class="katex-error">${escapeHtml(latex)}</span>`;
      }
      container.appendChild(line);
    });

    return container;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKaTeX);
  } else {
    initKaTeX();
  }

  // Export API
  window.KaTeXInit = {
    render: renderElement,
    renderAll: renderAllMath,
    reRender,
    copyLatex,
    showLatexSource,
    containsMath,
    createNumberedEquation,
    createAlignedEquations,
    CONFIG
  };

})();