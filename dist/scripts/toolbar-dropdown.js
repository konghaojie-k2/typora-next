/**
 * Toolbar Dropdown - dropdown open/close state machine for toolbar menus
 *
 * IIFE + dual-export (theme-manager.js pattern) so Node.js unit tests and
 * BDD step defs can require the real module.
 *
 * Used by the export menu (导出 Word / 导出 PDF / 分享打包, 2026-08-03):
 * the three buttons keep their original ids as menu items, so existing
 * click handlers in main.js need no changes.
 *
 * State machine:
 *   closed --trigger click--> open
 *   open   --trigger click / item click / outside click / Escape--> closed
 *
 * Listeners are attached once in create() and are no-ops while closed;
 * the document click handler ignores clicks inside trigger/menu so a
 * trigger click that bubbles up cannot re-open the menu it just closed.
 */
(function() {
  'use strict';

  /**
   * @param {object} options
   * @param {Element} options.trigger - button that toggles the dropdown
   * @param {Element} options.menu - dropdown container; gets the 'open' class
   * @param {Document} [options.doc] - document for outside-click/Escape listeners
   * @returns {{open: Function, close: Function, toggle: Function, isOpen: Function, destroy: Function}}
   */
  function create(options) {
    const trigger = options.trigger;
    const menu = options.menu;
    const doc = options.doc || (typeof document !== 'undefined' ? document : null);

    let open = false;

    function isOpen() {
      return open;
    }

    function openMenu() {
      open = true;
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    function closeMenu() {
      if (!open) return;
      open = false;
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
      if (open) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    function onTriggerClick() {
      toggle();
    }

    function onMenuClick(e) {
      // Item click closes the menu; clicks on non-item content keep it open.
      let node = e.target;
      while (node && node !== menu) {
        if (node.classList && node.classList.contains('toolbar-dropdown-item')) {
          closeMenu();
          return;
        }
        node = node.parentNode || node._parent || null;
      }
    }

    function onDocumentClick(e) {
      if (!open) return;
      const target = e.target;
      if (target && (trigger.contains(target) || menu.contains(target))) return;
      closeMenu();
    }

    function onDocumentKeydown(e) {
      if (!open) return;
      if (e.key === 'Escape') closeMenu();
    }

    trigger.addEventListener('click', onTriggerClick);
    menu.addEventListener('click', onMenuClick);
    if (doc) {
      doc.addEventListener('click', onDocumentClick);
      doc.addEventListener('keydown', onDocumentKeydown);
    }

    function destroy() {
      trigger.removeEventListener('click', onTriggerClick);
      menu.removeEventListener('click', onMenuClick);
      if (doc) {
        doc.removeEventListener('click', onDocumentClick);
        doc.removeEventListener('keydown', onDocumentKeydown);
      }
      closeMenu();
    }

    return {
      open: openMenu,
      close: closeMenu,
      toggle: toggle,
      isOpen: isOpen,
      destroy: destroy
    };
  }

  const api = { create: create };

  // Node.js export (for unit + BDD tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  // Browser global
  if (typeof window !== 'undefined') {
    window.ToolbarDropdown = api;
  }
})();
