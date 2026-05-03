/**
 * Prism.js Initialization
 * Enhanced code highlighting with language detection and copy functionality
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    // Language aliases for common shortcuts
    languageAliases: {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'shell': 'bash',
      'yml': 'yaml',
      'md': 'markdown',
      'docker': 'dockerfile',
      'k8s': 'yaml'
    },

    // Languages that should show line numbers by default
    lineNumbersLanguages: ['javascript', 'typescript', 'python', 'rust', 'go', 'java'],

    // Show copy button
    showCopyButton: true,

    // Show language label
    showLanguageLabel: true,

    // Custom class for code blocks
    codeBlockClass: 'code-block-enhanced'
  };

  /**
   * Initialize Prism.js enhancements
   */
  function initPrism() {
    if (typeof Prism === 'undefined') {
      console.warn('Prism.js not loaded');
      return;
    }

    // Set language aliases
    Object.entries(CONFIG.languageAliases).forEach(([alias, language]) => {
      Prism.languages[alias] = Prism.languages[language];
    });

    // Configure autoloader
    if (Prism.plugins && Prism.plugins.autoloader) {
      Prism.plugins.autoloader.languages_path =
        'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
    }

    // Process all code blocks
    processCodeBlocks();

    // Add mutation observer for dynamic content
    observeCodeBlocks();
  }

  /**
   * Process existing code blocks
   */
  function processCodeBlocks() {
    const codeBlocks = document.querySelectorAll('pre code[class*="language-"]');

    codeBlocks.forEach(codeBlock => {
      const pre = codeBlock.parentElement;
      if (!pre || pre.classList.contains(CONFIG.codeBlockClass)) return;

      enhanceCodeBlock(pre, codeBlock);
    });
  }

  /**
   * Enhance a single code block
   */
  function enhanceCodeBlock(pre, codeBlock) {
    pre.classList.add(CONFIG.codeBlockClass);

    // Get language from class
    const language = getLanguageFromClass(codeBlock.className);

    // Add language label
    if (CONFIG.showLanguageLabel && language) {
      pre.setAttribute('data-language', language);
    }

    // Add line numbers for configured languages
    if (CONFIG.lineNumbersLanguages.includes(language)) {
      pre.classList.add('line-numbers');
    }

    // Add copy button
    if (CONFIG.showCopyButton) {
      addCopyButton(pre, codeBlock);
    }

    // Add scroll indicators
    addScrollIndicators(pre, codeBlock);

    // Highlight the code
    Prism.highlightElement(codeBlock);
  }

  /**
   * Get language from class name
   */
  function getLanguageFromClass(className) {
    const match = className.match(/language-(\w+)/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Add copy button to code block
   */
  function addCopyButton(pre, codeBlock) {
    // Create actions container
    let actionsContainer = pre.querySelector('.code-block-actions');
    if (!actionsContainer) {
      actionsContainer = document.createElement('div');
      actionsContainer.className = 'code-block-actions';
      pre.appendChild(actionsContainer);
    }

    // Create copy button
    const copyButton = document.createElement('button');
    copyButton.className = 'code-block-btn';
    copyButton.textContent = 'Copy';
    copyButton.type = 'button';
    copyButton.setAttribute('aria-label', 'Copy code to clipboard');

    copyButton.addEventListener('click', async () => {
      try {
        await copyToClipboard(codeBlock.textContent);
        copyButton.textContent = 'Copied!';
        copyButton.classList.add('copied');

        setTimeout(() => {
          copyButton.textContent = 'Copy';
          copyButton.classList.remove('copied');
        }, 2000);
      } catch (err) {
        copyButton.textContent = 'Failed';
        console.error('Copy failed:', err);
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      }
    });

    actionsContainer.appendChild(copyButton);
  }

  /**
   * Add scroll indicators
   */
  function addScrollIndicators(pre, codeBlock) {
    const updateScrollIndicators = () => {
      const isScrollable = codeBlock.scrollWidth > codeBlock.clientWidth;

      if (isScrollable) {
        pre.classList.toggle('code-scroll-left', codeBlock.scrollLeft > 10);
        pre.classList.toggle('code-scroll-right',
          codeBlock.scrollLeft < codeBlock.scrollWidth - codeBlock.clientWidth - 10);
      } else {
        pre.classList.remove('code-scroll-left', 'code-scroll-right');
      }
    };

    codeBlock.addEventListener('scroll', updateScrollIndicators);
    window.addEventListener('resize', updateScrollIndicators);

    // Initial check
    setTimeout(updateScrollIndicators, 100);
  }

  /**
   * Copy text to clipboard
   */
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }

  /**
   * Observe DOM for new code blocks
   */
  function observeCodeBlocks() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const codeBlocks = node.querySelectorAll ?
              node.querySelectorAll('pre code[class*="language-"]') : [];

            codeBlocks.forEach(codeBlock => {
              const pre = codeBlock.parentElement;
              if (pre && !pre.classList.contains(CONFIG.codeBlockClass)) {
                enhanceCodeBlock(pre, codeBlock);
              }
            });

            // Check if the added node itself is a code block
            if (node.nodeName === 'CODE' && node.className.includes('language-')) {
              const pre = node.parentElement;
              if (pre && !pre.classList.contains(CONFIG.codeBlockClass)) {
                enhanceCodeBlock(pre, node);
              }
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Create code tabs for multiple code blocks
   */
  function createCodeTabs(containers, labels) {
    if (!containers || containers.length < 2) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-group';

    const tabs = document.createElement('div');
    tabs.className = 'code-group-tabs';

    containers.forEach((container, index) => {
      const tab = document.createElement('button');
      tab.className = 'code-group-tab' + (index === 0 ? ' active' : '');
      tab.textContent = labels[index] || `Tab ${index + 1}`;
      tab.type = 'button';

      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.code-group-tab').forEach(t => t.classList.remove('active'));
        wrapper.querySelectorAll('.code-group-content').forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        content.classList.add('active');
      });

      tabs.appendChild(tab);

      const content = document.createElement('div');
      content.className = 'code-group-content' + (index === 0 ? ' active' : '');
      content.appendChild(container.cloneNode(true));
      wrapper.appendChild(content);
    });

    wrapper.insertBefore(tabs, wrapper.firstChild);
    containers[0].parentNode.replaceChild(wrapper, containers[0]);

    // Remove other containers
    for (let i = 1; i < containers.length; i++) {
      containers[i].remove();
    }
  }

  /**
   * Re-highlight all code blocks
   */
  function rehighlight() {
    if (typeof Prism === 'undefined') return;

    document.querySelectorAll('pre code').forEach(codeBlock => {
      Prism.highlightElement(codeBlock);
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPrism);
  } else {
    initPrism();
  }

  // Export API
  window.PrismInit = {
    rehighlight,
    processCodeBlocks,
    createCodeTabs,
    CONFIG
  };

})();