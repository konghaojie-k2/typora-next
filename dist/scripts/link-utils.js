/**
 * Link Utils — 正文链接路径解析（纯函数，Node 可测）
 *
 * 问题背景（2026-11-05 实爆）：正文 [说明](./doc.html) / file:// 链接
 * 点击无反应 —— 渲染管线对 <a> 零处理，相对链接按 webview 源导航 404。
 *
 * main.js initLinkHandling 分流：
 *   http(s) → open_external（系统浏览器）
 *   其余    → resolveLinkHref 解析为绝对路径 → open_local_file（系统默认应用）
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LinkUtils = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  /**
   * 把正文中 <a href> 解析为本地绝对路径。
   * @param {string} href - 链接目标（file:// / POSIX 绝对 / Windows 盘符 / 相对）
   * @param {string} baseDir - 工作区目录（md 目录缺失时回退）
   * @param {string} filePath - 当前 md 文件绝对路径（优先作为相对基准）
   * @returns {string} 绝对路径（无法定位时返回原值，Rust 端拒绝相对路径兜底）
   */
  function resolveLinkHref(href, baseDir, filePath) {
    let h = String(href).trim().replace(/\\/g, '/');

    // file:// URL → 文件系统路径（macOS file:///a → /a；Windows file:///C:/ → C:/）
    if (/^file:\/\//i.test(h)) {
      const raw = h.slice('file://'.length);
      try {
        h = decodeURIComponent(raw);
      } catch (err) {
        h = raw; // 非法编码保持原样
      }
      if (/^\/[A-Za-z]:\//.test(h)) h = h.slice(1); // Windows 盘符前导斜杠
      return h;
    }

    // 绝对路径原样返回
    if (h.startsWith('/') || /^[A-Za-z]:\//.test(h)) return h;

    // 相对路径：优先 md 所在目录，缺失回退 baseDir
    const mdDir = filePath
      ? filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      : '';
    const base = mdDir || (baseDir || '');
    if (!base) return h;

    const segs = (base + '/' + h).split('/');
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === '..') {
        if (out.length > 0 && out[out.length - 1] !== '') out.pop();
      } else if (seg === '.') {
        // 跳过
      } else if (seg === '') {
        if (out.length === 0) out.push(''); // 保留 POSIX 前导空段（绝对路径）
      } else {
        out.push(seg);
      }
    }
    return out.join('/');
  }

  /**
   * 在文本中查找第一个裸 URL（file:// 或 http(s)://）。
   * pulldown-cmark 未开 autolink（CommonMark 需要 <> / []() 语法才成链接），
   * 正文粘贴的裸 URL 保持纯文本不可点击 —— 渲染层用此匹配包成 <a>。
   * 匹配端点：空白与尖括号/引号/成对括号字符；尾随中英文标点不入链接
   * （句子以 URL 结尾的场景），括号按配对保留（wiki 页面名常含括号）。
   * @param {string} text - 待扫描文本
   * @returns {{url: string, start: number, end: number}|null}
   */
  function findUrlInText(text) {
    if (!text) return null;
    const re = /(?:file:\/\/\/?|https?:\/\/)[^\s<>"'，。；！？【】《》「」『』]+/gi;
    const m = re.exec(String(text));
    if (!m) return null;
    let url = m[0];
    // 剥离尾随标点；右括号仅在无配对左括号时剥离
    while (url.length > 0) {
      const last = url[url.length - 1];
      if (!/[.,;:!?)\]}」』）"'”’]/.test(last)) break;
      if (/[)\]}]/.test(last)) {
        const opens = (url.match(/[([{]/g) || []).length;
        const closes = (url.match(/[)\]}]/g) || []).length;
        if (closes > opens) { url = url.slice(0, -1); continue; }
        break;
      }
      url = url.slice(0, -1);
    }
    if (!url) return null;
    return { url, start: m.index, end: m.index + url.length };
  }

  /**
   * 遍历元素内文本节点，把裸 URL 包成 <a href>（GFM autolink 语义）。
   * 跳过已有链接与代码块（代码内 URL 展示原样）；幂等（<a> 内不再匹配）。
   * @param {Element} root - 渲染容器
   * @returns {number} 生成的 <a> 数量
   */
  function linkifyElement(root) {
    if (!root || typeof document === 'undefined') return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.indexOf('://') === -1) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (p && (p.closest('a') || p.closest('code') || p.closest('pre'))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    let made = 0;
    targets.forEach((node) => {
      let cur = node;
      let guard = 0;
      while (cur && cur.nodeType === 3 && guard++ < 100) {
        const hit = findUrlInText(cur.nodeValue);
        if (!hit) break;
        const a = document.createElement('a');
        a.href = hit.url;
        a.textContent = hit.url;
        const range = document.createRange();
        range.setStart(cur, hit.start);
        range.setEnd(cur, hit.end);
        range.deleteContents(); // cur 留前段，尾段自动成兄弟文本节点
        range.insertNode(a);
        made++;
        cur = a.nextSibling; // 继续处理尾段（同节点可能还有下一个 URL）
      }
    });
    return made;
  }

  return { resolveLinkHref, findUrlInText, linkifyElement };
});
