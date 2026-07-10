/**
 * Minimal mock DOM for testing mode-integration.js without jsdom
 * Supports: createElement, getElementById, querySelector, querySelectorAll,
 * innerHTML parsing (simple), classList, dataset, style, addEventListener, click
 */

function buildMockDOM() {
  const allElements = [];

  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      _innerHTML: '',
      _textContent: '',
      _classes: [],
      _attrs: {},
      _dataset: {},
      _listeners: {},
      _parent: null,
      _removed: false,
      _children: [],

      style: {
        get cssText() {
          return Object.entries(el.style)
            .filter(([k]) => k !== 'cssText')
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ');
        },
        set cssText(v) {
          // Clear existing styles (except cssText getter/setter)
          Object.keys(el.style).forEach(k => {
            if (k !== 'cssText') delete el.style[k];
          });
          if (!v) return;
          v.split(';').forEach(rule => {
            const idx = rule.indexOf(':');
            if (idx > 0) {
              const key = rule.slice(0, idx).trim();
              const val = rule.slice(idx + 1).trim();
              if (key) el.style[key] = val;
            }
          });
        }
      },

      get classList() {
        const self = el;
        return {
          add(c) { if (!self._classes.includes(c)) self._classes.push(c); },
          remove(c) { self._classes = self._classes.filter(x => x !== c); },
          contains(c) { return self._classes.includes(c); },
          toggle(c) { self.classList.contains(c) ? self.classList.remove(c) : self.classList.add(c); }
        };
      },

      get className() { return el._classes.join(' '); },
      set className(v) { el._classes = v.split(/\s+/).filter(Boolean); },

      get dataset() {
        const self = el;
        return new Proxy({}, {
          get(_, p) { return self._dataset[p]; },
          set(_, p, v) { self._dataset[p] = v; return true; }
        });
      },

      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] || null; },
      removeAttribute(k) { delete el._attrs[k]; },

      appendChild(c) {
        if (c._parent) c._parent.removeChild(c);
        c._parent = el;
        el._children.push(c);
        return c;
      },

      removeChild(c) {
        el._children = el._children.filter(x => x !== c);
        if (c._parent === el) c._parent = null;
      },

      remove() {
        if (el._parent) el._parent.removeChild(el);
        el._removed = true;
      },

      get isConnected() { return el._parent !== null && !el._removed; },

      addEventListener(ev, fn) {
        (el._listeners[ev] = el._listeners[ev] || []).push(fn);
      },

      removeEventListener(ev, fn) {
        if (el._listeners[ev]) {
          el._listeners[ev] = el._listeners[ev].filter(f => f !== fn);
        }
      },

      click() {
        (el._listeners.click || []).forEach(fn => fn({ target: el, currentTarget: el }));
      },

      querySelector(sel) {
        for (const c of el._children) {
          if (matchesSelector(c, sel)) return c;
          const found = c.querySelector(sel);
          if (found) return found;
        }
        return null;
      },

      querySelectorAll(sel) {
        const out = [];
        for (const c of el._children) {
          if (matchesSelector(c, sel)) out.push(c);
          out.push(...c.querySelectorAll(sel));
        }
        return out;
      },

      get innerHTML() { return el._innerHTML; },
      set innerHTML(v) {
        el._innerHTML = v;
        el._children = [];
        parseSimpleHTML(v, el);
      },

      get textContent() { return el._textContent; },
      set textContent(v) { el._textContent = v; }
    };

    allElements.push(el);
    return el;
  }

  function matchesSelector(el, sel) {
    if (!el) return false;

    // Handle :not(...)
    const notMatch = sel.match(/(.*):not\((.+)\)/);
    if (notMatch) {
      return matchesSelector(el, notMatch[1]) && !matchesSelector(el, notMatch[2]);
    }

    if (sel.startsWith('#')) return (el._attrs.id || el.id) === sel.slice(1);
    if (sel.startsWith('.')) return el._classes.includes(sel.slice(1));
    if (sel.startsWith('[')) {
      const m = sel.match(/\[(.+?)(?:=(["']?)(.+?)\2)?\]/);
      if (m) {
        const attr = m[1];
        const val = m[3];
        const datasetKey = attr.startsWith('data-') ? attr.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()) : null;
        if (val !== undefined) {
          return el._attrs[attr] === val || el._dataset[attr] === val || (datasetKey && el._dataset[datasetKey] === val);
        }
        return attr in el._attrs || attr in el._dataset || (datasetKey && datasetKey in el._dataset);
      }
    }
    if (sel.toLowerCase() === el.tagName.toLowerCase()) return true;
    return false;
  }

  function parseSimpleHTML(html, parent) {
    // Parse top-level tags
    const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const tag = match[1];
      const attrsStr = match[2];
      const content = match[3];

      const child = createElement(tag);

      // Parse attributes
      const attrRegex = /([a-zA-Z-]+)=(["'])([^"']*)\2/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        const name = attrMatch[1];
        const value = attrMatch[3];
        if (name === 'id') child._attrs.id = value;
        else if (name === 'class') child._classes.push(...value.split(/\s+/).filter(Boolean));
        else if (name === 'style') {
          value.split(';').forEach(s => {
            const [k, v] = s.split(':').map(x => x.trim());
            if (k && v) child.style[k] = v;
          });
        }
        else child._attrs[name] = value;
      }

      // Parse dataset attributes
      const dataAttrRegex = /data-([a-zA-Z-]+)=(["'])([^"']*)\2/g;
      let dataMatch;
      while ((dataMatch = dataAttrRegex.exec(attrsStr)) !== null) {
        const key = dataMatch[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        child._dataset[key] = dataMatch[3];
      }

      if (!content.includes('<')) {
        child._textContent = content.replace(/^\s+|\s+$/g, '');
      } else {
        parseSimpleHTML(content, child);
      }

      parent.appendChild(child);
    }

    // Self-closing tags: input, br, hr, img
    const selfCloseRegex = /<([a-zA-Z0-9]+)([^>]*)\s*\/>/g;
    while ((match = selfCloseRegex.exec(html)) !== null) {
      const tag = match[1];
      const attrsStr = match[2];
      const child = createElement(tag);

      const attrRegex = /([a-zA-Z-]+)=(["'])([^"']*)\2/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        const name = attrMatch[1];
        const value = attrMatch[3];
        if (name === 'id') child._attrs.id = value;
        else if (name === 'class') child._classes.push(...value.split(/\s+/).filter(Boolean));
        else child._attrs[name] = value;
      }

      parent.appendChild(child);
    }
  }

  const body = createElement('body');
  body._attrs.id = 'body';

  const docListeners = {};

  const doc = {
    createElement,
    createElementNS: createElement,
    body,

    getElementById(id) {
      for (const el of allElements) {
        if ((el._attrs.id || el.id) === id && !el._removed) return el;
      }
      return null;
    },

    querySelector(sel) {
      if (sel.startsWith('#')) return doc.getElementById(sel.slice(1));
      return body.querySelector(sel);
    },

    querySelectorAll(sel) {
      if (sel.startsWith('#')) {
        const el = doc.getElementById(sel.slice(1));
        return el ? [el] : [];
      }
      return body.querySelectorAll(sel);
    },

    addEventListener(ev, fn) {
      (docListeners[ev] = docListeners[ev] || []).push(fn);
    },

    removeEventListener(ev, fn) {
      if (docListeners[ev]) {
        docListeners[ev] = docListeners[ev].filter(f => f !== fn);
      }
    },

    // Test helper: dispatch event to document listeners
    _dispatchDocEvent(ev, data) {
      (docListeners[ev] || []).forEach(fn => fn(data));
    }
  };

  return { document: doc, body, createElement, allElements };
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildMockDOM };
}
