/**
 * Obsidian ==highlight== 跨内联元素高亮
 *
 * 背景（2026-11-05 实爆）：正文 ==🔴**密闭不可侵入…**== 未渲染。
 * 原因：pulldown-cmark 先把 **bold** 变成 <strong>，旧的 replaceInTextNodes
 * 逐“单个文本节点”跑正则 —— 开头 ==🔴 与结尾 == 落在不同节点，配不上对。
 *
 * 方案：TreeWalker 走块级元素，收集该块内全部文本节点，按“拼接串”匹配
 * ==..==，跨节点区域用 Range.surroundContents 包成 <mark>。mark 是合法
 * 块级拆分点，PPT 装箱/拆分层无需感知。
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ObsidianHighlight = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  /**
   * 在纯文本中匹配第一组 ==...==。
   * 与 Obsidian 语义对齐：
   *   - 内部内容不能以空白开头/结尾
   *   - 排除 === 与 ====（空内容）
   *   - 内部不能再含 ==（防嵌套歧义）
   * @param {string} text
   * @returns {{outerStart,outerEnd,innerStart,innerEnd,innerText}|null}
   */
  function matchHighlightInText(text) {
    if (!text) return null;
    const s = String(text);
    let i = 0;
    while (i < s.length) {
      // 找开 ==（前字符不能是 =，防 === 串）
      const open = s.indexOf('==', i);
      if (open === -1) return null;
      const beforeOpen = s[open - 1];
      if (beforeOpen === '=') { i = open + 1; continue; }
      const afterOpen = s[open + 2];
      if (afterOpen === undefined || /\s/.test(afterOpen) || afterOpen === '=') {
        i = open + 1;
        continue;
      }
      // 从开 == 后 2 个字符起，找第一个 ==（内部不含 == → 第一个遇到的即闭包）
      const close = s.indexOf('==', open + 2);
      if (close === -1) return null;
      const inner = s.slice(open + 2, close);
      // 排除 ==x==== / ==x=== 之类的空尾：inner 内不允许再出现 ==
      if (inner.indexOf('==') !== -1) {
        i = open + 2;
        continue;
      }
      // 闭 == 前不能是空白（如 `==开头空格 高亮 ==` 不合格）
      const beforeClose = s[close - 1];
      if (/\s/.test(beforeClose)) {
        i = close + 1;
        continue;
      }
      return {
        outerStart: open,
        outerEnd: close + 2,
        innerStart: open + 2,
        innerEnd: close,
        innerText: inner
      };
    }
    return null;
  }

  /**
   * 创建带 Obsidian 高亮 class 的 <mark>。
   */
  function markElement() {
    const m = document.createElement('mark');
    m.className = 'obsidian-highlight';
    return m;
  }

  /**
   * 收集从 start 到 end（不含）之间的所有节点（深度优先，含元素子节点）。
   * 用于跨节点 inner 范围提取。
   */
  function collectRangeNodes(start, end) {
    const result = [];
    let cur = start;
    while (cur && cur !== end) {
      result.push(cur);
      if (cur.firstChild && cur !== end) {
        cur = cur.firstChild;
      } else if (cur.nextSibling) {
        cur = cur.nextSibling;
      } else {
        // 回溯到祖先的下一个兄弟
        while (cur && !cur.nextSibling && cur !== end) {
          cur = cur.parentNode;
        }
        if (cur && cur !== end) cur = cur.nextSibling;
      }
    }
    return result;
  }

  /**
   * 收集跨节点 inner 范围内的顶层兄弟节点（用于 mark 包装）。
   * 从 startNode 开始，沿 nextSibling 走到 endNode；元素节点递归到其子节点。
   * 例如 splitStart(text) → strong 元素 → strong 的子 text → splitEnd(text)
   */
  function collectInnerTopLevel(splitStart, splitEnd) {
    const result = [];
    let cur = splitStart;
    while (cur && cur !== splitEnd) {
      result.push(cur);
      if (cur.firstChild && cur !== splitEnd) {
        cur = cur.firstChild;
      } else {
        // 找下一个兄弟；没有则回溯到父级的下一个兄弟
        while (cur && cur !== splitEnd && !cur.nextSibling) {
          cur = cur.parentNode;
        }
        if (cur && cur !== splitEnd) {
          cur = cur.nextSibling;
        }
      }
    }
    return result;
  }

  /**
   * 遍历容器内的块级元素，把 ==...== 文本包成 <mark class="obsidian-highlight">。
   * 跳过 code/pre/script/a/mark 等保护区；幂等（已有 mark 内不再匹配）。
   * @param {Element} container
   * @returns {number} 生成的 <mark> 数量
   */
  function observeHighlight(container) {
    if (!container || typeof document === 'undefined') return 0;
    const EXCLUDE = 'code, pre, script, style, .mermaid, a, mark, .obsidian-tag';
    const blocks = container.querySelectorAll(
      'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, div'
    );
    let made = 0;

    blocks.forEach(function (block) {
      if (block.closest(EXCLUDE)) return;

      // 循环匹配并替换（直到无剩余 ==..==）
      let guard = 0;
      while (guard++ < 200) {
        // 收集当前块内文本节点 + 拼接串
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) {
          if (walker.currentNode.parentElement.closest(EXCLUDE)) continue;
          nodes.push(walker.currentNode);
        }
        if (nodes.length === 0) return;

        let joined = '';
        const positions = [];
        nodes.forEach(function (n) {
          positions.push(joined.length);
          joined += n.nodeValue;
        });

        const hit = matchHighlightInText(joined);
        if (!hit) break;

        // 定位 innerStart 与 innerEnd 各自落在哪个文本节点
        let startNodeIdx = -1;
        let endNodeIdx = -1;
        for (let i = 0; i < nodes.length; i++) {
          const nodeStart = positions[i];
          const nodeEnd = nodeStart + nodes[i].nodeValue.length;
          if (startNodeIdx === -1 && nodeStart <= hit.innerStart && hit.innerStart < nodeEnd) {
            startNodeIdx = i;
          }
          if (endNodeIdx === -1 && nodeStart < hit.innerEnd && hit.innerEnd <= nodeEnd) {
            endNodeIdx = i;
          }
        }
        if (startNodeIdx < 0 || endNodeIdx < 0) break;

        const startNode = nodes[startNodeIdx];
        const endNode = nodes[endNodeIdx];
        const startOff = hit.innerStart - positions[startNodeIdx];
        const endOff = hit.innerEnd - positions[endNodeIdx];

        // splitText 把 startNode/endNode 在 inner 边界处切开
        let splitStart = null;
        let splitEnd = null;
        try {
          splitStart = startNode.splitText(startOff); // splitStart = inner 起点处的文本节点
          const innerLen = hit.innerEnd - hit.innerStart;
          if (endNode === startNode) {
            // endNode 在 startNode 内（同节点）→ 相对 splitStart 切
            splitEnd = splitStart.splitText(innerLen);
          } else if (endOff === endNode.nodeValue.length) {
            // endOff 指向 endNode 末尾 → splitText 产生空 splitEnd，无意义
            // 真正的 inner 终点是 endNode 之后的节点
            splitEnd = null; // 标记：稍后特殊处理
          } else if (endOff === 0) {
            // endNode 整个在 inner 内（endOff=0 意味着 endNode 的起点就是 innerEnd）
            splitEnd = endNode;
          } else {
            splitEnd = endNode.splitText(endOff);
          }
        } catch (err) {
          break;
        }

        // 擦掉 ==：startNode 末尾的 ==（split 后）
        const startVal = startNode.nodeValue;
        if (startVal.endsWith('==')) startNode.nodeValue = startVal.slice(0, -2);

        // 处理闭 ==：根据 splitEnd 类型
        if (splitEnd === endNode) {
          // endNode 整个在 inner 内（endOff=0）→ 闭 == 在 endNode 的 nextSibling（strong 的 nextSibling）
          const afterEnd = endNode.nextSibling;
          if (afterEnd && afterEnd.nodeType === 3 && afterEnd.nodeValue.startsWith('==')) {
            afterEnd.nodeValue = afterEnd.nodeValue.slice(2);
          }
        } else if (splitEnd === null) {
          // endOff 在 endNode 末尾 → 闭 == 在 endNode 之后的第一个文本节点
          // 先找 endNode 的 nextSibling（可能在 strong 内或 strong 外）
          let afterEnd = endNode.nextSibling;
          if (!afterEnd && endNode.parentElement) {
            // endNode 是 strong 的唯一子节点 → afterEnd 在 strong 的 nextSibling
            afterEnd = endNode.parentElement.nextSibling;
          }
          if (afterEnd && afterEnd.nodeType === 3 && afterEnd.nodeValue.startsWith('==')) {
            afterEnd.nodeValue = afterEnd.nodeValue.slice(2);
          }
        } else {
          // splitEnd 是从 endNode 切出来的，开头可能有 ==
          const endVal = splitEnd.nodeValue;
          if (endVal.startsWith('==')) splitEnd.nodeValue = endVal.slice(2);
        }

        // 收集 inner 的顶层兄弟节点：splitStart 到 inner 终点之间
        // inner 终点 = splitEnd（若非 null）或 endNode 的 nextSibling（splitEnd=null 时）
        let innerBoundary = null;
        if (splitEnd !== null) {
          innerBoundary = (splitEnd === endNode) ? endNode : splitEnd;
        } else {
          // splitEnd=null：inner 终点在 endNode 之后（可能跨元素）
          // 找 endNode 之后的第一个节点（可能是 strong 的 nextSibling，或更上层）
          let afterEnd = endNode.nextSibling;
          if (!afterEnd && endNode.parentElement) {
            afterEnd = endNode.parentElement.nextSibling;
          }
          innerBoundary = afterEnd;
        }

        const innerTopLevel = [];
        let cur = splitStart;
        while (cur && cur !== innerBoundary) {
          innerTopLevel.push(cur);
          cur = cur.nextSibling;
        }

        // 创建 mark 并填入 innerTopLevel 的克隆
        const mark = markElement();
        innerTopLevel.forEach(function (n) {
          mark.appendChild(n.cloneNode(true));
        });

        // 从原 DOM 删除 inner 顶层节点
        innerTopLevel.forEach(function (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
        });

        // 把 mark 放到原 inner 位置：innerBoundary 之前
        if (innerBoundary && innerBoundary.parentNode) {
          innerBoundary.parentNode.insertBefore(mark, innerBoundary);
        }

        // 清理空节点
        if (startNode.nodeValue === '' && startNode.parentNode) startNode.parentNode.removeChild(startNode);
        if (splitEnd && splitEnd.nodeValue === '' && splitEnd.parentNode) splitEnd.parentNode.removeChild(splitEnd);
        made++;
      }
    });

    return made;
  }

  return { observeHighlight, matchHighlightInText, markElement };
});
