/**
 * CJK Align — 修复代码块内 ASCII 线框图因 CJK 字宽不等于 2 倍拉丁字宽而错位
 *
 * 背景：pre code 字体栈（JetBrains Mono/Consolas/...）不含 CJK 字形，
 * CJK 字符回退到系统字体（如微软雅黑），其字宽 ≠ 2 × 拉丁等宽字宽，
 * 导致按 2 列对齐绘制的线框图右边框整体漂移、甚至溢出被裁切。
 *
 * 方案（字体无关、自适应）：
 * 1. 用 canvas 实测该代码块计算字体下拉丁字符（'0'）与 CJK 字符（'中'）的字宽
 * 2. diff = 2×latin − cjk，|diff| 小于阈值则不动（字体本身 2:1 时零侵入）
 * 3. 把每个 CJK 连续段包进 <span class="cjk-align">，letter-spacing = diff（em 单位）
 *    使每个 CJK 字符恰好占 2 个拉丁列
 * 4. 最宽行超过容器宽度的块按比例缩小字号（自适应，下限 9px）
 *
 * 跳过 mermaid。复制/下载走 textContent，不受影响。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CJKAlign = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // CJK 统一表意文字（含扩展A）+ 兼容表意 + CJK 标点（含全角空格 U+3000）+ 全角 ASCII/符号
  const CJK_CLASS = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\u3000-\\u303F\\uFF00-\\uFF60\\uFFE0-\\uFFE6';
  const CJK_RE = new RegExp('[' + CJK_CLASS + ']');
  const CJK_RUN_RE = new RegExp('[' + CJK_CLASS + ']+', 'g');

  /** 字宽差小于该值（px）视为已对齐，不做任何处理 */
  const EPSILON_PX = 0.3;

  /** 自适应缩小的字号下限：低于该值宁可保留横向滚动条 */
  const MIN_FONT_SIZE_PX = 9;

  function containsCJK(text) {
    return CJK_RE.test(text);
  }

  /**
   * 计算每个 CJK 字符需要补偿的 letter-spacing。
   * @returns {number|null} px 补偿值；已对齐（|diff| 很小）时返回 null
   */
  function computeLetterSpacing(latinWidth, cjkWidth) {
    if (!(latinWidth > 0) || !(cjkWidth > 0)) return null;
    const diff = 2 * latinWidth - cjkWidth;
    return Math.abs(diff) < EPSILON_PX ? null : diff;
  }

  /** px 补偿值换算成 em（相对字号），字号缩放时补偿自动跟随 */
  function pxToEm(diffPx, fontSizePx) {
    return diffPx / fontSizePx;
  }

  /**
   * 代码块过宽时的自适应字号：按比例缩小让最宽行恰好放下。
   * 注意传入的应是"内容宽度"和"可用宽度"（均已扣除 padding），
   * 否则 padding 不参与缩放会留下残差溢出。
   * @returns {number|null} 新字号（px）；不需要缩放或已到下限时返回 null
   */
  function computeFitFontSize(contentWidth, usableWidth, fontSizePx, minFontSizePx = MIN_FONT_SIZE_PX) {
    if (!(contentWidth > 0) || !(usableWidth > 0) || !(fontSizePx > 0)) return null;
    if (contentWidth <= usableWidth + 1) return null; // 1px 容差
    const scaled = Math.floor(fontSizePx * (usableWidth / contentWidth) * 100) / 100;
    if (scaled < minFontSizePx) return null; // 缩得太小宁可保留滚动条
    if (scaled >= fontSizePx) return null;
    return scaled;
  }

  /**
   * 把文本切分为 [{ text, cjk }] 段，cjk=true 的段是连续 CJK 字符。
   * 纯函数，DOM 无关，便于测试。
   */
  function splitRuns(text) {
    const runs = [];
    let last = 0;
    CJK_RUN_RE.lastIndex = 0;
    let m;
    while ((m = CJK_RUN_RE.exec(text)) !== null) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index), cjk: false });
      runs.push({ text: m[0], cjk: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push({ text: text.slice(last), cjk: false });
    return runs;
  }

  // ------------------------------------------
  // 以下为浏览器 DOM 部分
  // ------------------------------------------

  let measureCtx = null;
  const measureCache = new Map(); // fontString -> { latin, cjk }

  function measureWidths(fontString) {
    if (measureCache.has(fontString)) return measureCache.get(fontString);
    if (!measureCtx) {
      const canvas = document.createElement('canvas');
      measureCtx = canvas.getContext('2d');
    }
    measureCtx.font = fontString;
    // 多字符取平均，降低取整误差
    const latin = measureCtx.measureText('0'.repeat(20)).width / 20;
    const cjk = measureCtx.measureText('中'.repeat(10)).width / 10;
    const result = { latin, cjk };
    measureCache.set(fontString, result);
    return result;
  }

  /** 把单个文本节点内的 CJK 段包上 span */
  function wrapTextNode(textNode) {
    const runs = splitRuns(textNode.nodeValue);
    if (!runs.some(r => r.cjk)) return;
    const frag = document.createDocumentFragment();
    for (const run of runs) {
      if (!run.cjk) {
        frag.appendChild(document.createTextNode(run.text));
      } else {
        const span = document.createElement('span');
        span.className = 'cjk-align';
        span.textContent = run.text;
        frag.appendChild(span);
      }
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }

  /**
   * 处理 container 下所有 pre code：
   * 1. 含 CJK 且字宽比不等于 2:1 的块做 letter-spacing 补偿（em 单位，随字号缩放）
   * 2. 最宽行超过容器宽度的块按比例缩小字号（下限 MIN_FONT_SIZE_PX，保不齐宁可滚动）
   * 在 Prism 高亮之后调用（TreeWalker 能穿透高亮 span）。
   */
  function apply(container) {
    if (!container || typeof document === 'undefined') return;
    const blocks = container.querySelectorAll('pre code');
    for (const code of blocks) {
      if (code.closest('pre.mermaid')) continue;

      const style = getComputedStyle(code);
      const fontSizePx = parseFloat(style.fontSize);

      if (containsCJK(code.textContent) && !code.querySelector('.cjk-align')) {
        const fontString = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const { latin, cjk } = measureWidths(fontString);
        const diff = computeLetterSpacing(latin, cjk);
        if (diff !== null) {
          const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
          const textNodes = [];
          while (walker.nextNode()) textNodes.push(walker.currentNode);
          for (const node of textNodes) wrapTextNode(node);

          code.style.setProperty('--cjk-letter-spacing', pxToEm(diff, fontSizePx).toFixed(4) + 'em');
        }
      }

      // 过宽则整体等比缩小（em 补偿自动跟随，无需重测）
      // padding 不随字号缩放，宽度比较必须扣除 padding；再留 2px 安全余量
      // 吸收 scrollWidth 整数取整与滚动条出现/消失的抖动
      const padH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const fit = computeFitFontSize(code.scrollWidth - padH, code.clientWidth - padH - 2, fontSizePx);
      if (fit !== null) code.style.fontSize = fit + 'px';
    }
  }

  return {
    containsCJK,
    computeLetterSpacing,
    computeFitFontSize,
    pxToEm,
    splitRuns,
    apply,
    // 测试用：清实测缓存
    _clearMeasureCache() { measureCache.clear(); }
  };
});
