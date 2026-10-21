/**
 * Export SVG Blocks — Word 导出时把内联 <svg> HTML 块转成图片
 *
 * 背景：docx-export（Rust）对 Event::Html / Event::InlineHtml 直接丢弃，
 * markdown 里的内联 <svg> 图形导出 Word 后消失。
 *
 * 方案（零 Rust 改动，复用现有 mermaid→png→docx 管线）：
 * 1. 扫描 markdown，收集代码围栏之外的内联 <svg>…</svg> 块
 * 2. 补 xmlns（usvg 解析必需，HTML 内联 svg 常省略）并量测内在尺寸
 *    （Image 实测优先，viewBox/width 属性兜底）
 * 3. 把每个 svg 块原位重写为 ```mermaid 围栏，围栏内容经与
 *    findMermaidBlocks 相同的 dedent+trim 归一化后作为 mermaid_images
 *    的 key —— Rust 端 render_svg_to_png 直接渲染该 svg，docx-export
 *    按 key 命中图片
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ExportSvgBlocks = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  /** 与 main.js dedentMermaidSource 逐字节一致——结果用作 mermaid_images key */
  function dedent(text) {
    const lines = text.split('\n');
    const indents = lines
      .filter((line) => line.trim().length > 0)
      .map((line) => (line.match(/^[ \t]*/) || [''])[0].length);
    if (!indents.length) return text.trim();
    const minIndent = Math.min(...indents);
    return lines.map((line) => line.slice(minIndent)).join('\n');
  }

  /**
   * 扫描 markdown（已归一化 LF），收集代码围栏之外的内联 svg 块。
   * @returns {Array<{text: string, startLine: number, endLine: number}>}
   */
  function extractInlineSvgBlocks(markdown) {
    const normalized = String(markdown).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const blocks = [];
    let inFence = false;
    let fenceChar = '';
    let svg = null; // { startLine, buf }

    lines.forEach((line, i) => {
      const fence = line.match(/^[ \t]{0,3}(```|~~~)/);
      if (fence) {
        const ch = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = ch;
        } else if (ch === fenceChar) {
          inFence = false;
        }
        if (svg) svg.buf.push(line);
        return;
      }
      if (inFence) return; // 围栏内容行不参与 svg 检测
      if (!svg) {
        if (/<svg[\s>]/.test(line)) {
          svg = { startLine: i, buf: [line] };
          if (/<\/svg\s*>/.test(line)) {
            blocks.push({ text: svg.buf.join('\n'), startLine: svg.startLine, endLine: i });
            svg = null;
          }
        }
      } else {
        svg.buf.push(line);
        if (/<\/svg\s*>/.test(line)) {
          blocks.push({ text: svg.buf.join('\n'), startLine: svg.startLine, endLine: i });
          svg = null;
        }
      }
    });
    return blocks;
  }

  /** viewBox / width-height 属性兜底量测 */
  function viewBoxSize(svgText) {
    const vb = svgText.match(/viewBox\s*=\s*"([\d.eE+\-\s]+)"/);
    if (vb) {
      const p = vb[1].trim().split(/[\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) {
        return { width: Math.round(p[2]), height: Math.round(p[3]) };
      }
    }
    return { width: 600, height: 400 };
  }

  /**
   * 补 xmlns 并量测 svg 内在尺寸。浏览器环境用 Image 实测（blob: 加载），
   * 无 DOM 环境（单元测试）直接走属性解析。
   * @returns {Promise<{svg: string, width: number, height: number}>}
   */
  function measureSvg(svgText) {
    const withXmlns = /<svg[^>]*\sxmlns=/.test(svgText)
      ? svgText
      : svgText.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');

    return new Promise((resolve) => {
      const finish = () => {
        const s = viewBoxSize(withXmlns);
        resolve({ svg: withXmlns, width: s.width, height: s.height });
      };
      if (typeof document === 'undefined' || typeof Blob === 'undefined') {
        finish();
        return;
      }
      const blob = new Blob([withXmlns], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = Math.round(img.naturalWidth);
        const h = Math.round(img.naturalHeight);
        if (w > 0 && h > 0) resolve({ svg: withXmlns, width: w, height: h });
        else finish();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        finish();
      };
      img.src = url;
    });
  }

  /**
   * 把 svg 归一化为「满宽/满视口 + 对称留白 + 居中」的导出形态。
   *
   * @param {string} svgText
   * @param {{pad?: number, fillViewport?: boolean}} [opts]
   *   - fillViewport: true  → width/height 均 100%，浏览器打开占满窗口、内容
   *     一屏居中（Mermaid 独立文件截图用）
   *   - fillViewport: false（默认）→ width="100%" + height 按 viewBox 比例
   *     算出固定值，与预览的自适应宽高比一致（正文插图——补 height="100%"
   *     会被解释成视口高，内容等比缩小泡在空白里，2026-10-21 实爆）
   * @returns {string}
   */
  function normalizeForExport(svgText, opts) {
    opts = opts || {};
    const PAD = typeof opts.pad === 'number' && opts.pad >= 0 ? opts.pad : 24;
    const m = svgText.match(/viewBox\s*=\s*"([\d.eE+\-\s]+)"/);
    if (!m) return svgText;
    const p = m[1].trim().split(/[\s,]+/).map(Number);
    if (p.length !== 4 || !(p[2] > 0) || !(p[3] > 0)) return svgText;
    const vx = p[0];
    const vy = p[1];
    const vw = p[2];
    const vh = p[3];

    const open = svgText.match(/<svg\b[^>]*>/i);
    if (!open) return svgText;
    let tag = open[0];

    // 1. 剥内联 max-width（只动根开标签；其余 style 声明保留）
    tag = tag.replace(/\sstyle="([^"]*)"/i, (full, body) => {
      const kept = body.split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^max-width\s*:/i.test(s))
        .join('; ');
      return kept ? ` style="${kept}"` : '';
    });

    // 2. 宽高形态（见 @param）
    const size = opts.fillViewport
      ? { width: '100%', height: '100%' }
      : { width: '100%', height: String(Math.round(((vh + PAD * 2) / (vw + PAD * 2)) * 10000) / 100) + '%' };
    if (/\swidth\s*=/i.test(tag)) {
      tag = tag.replace(/\swidth\s*=\s*"[^"]*"/i, ` width="${size.width}"`);
    } else {
      tag = tag.replace(/<svg\b/i, `<svg width="${size.width}"`);
    }
    if (/\sheight\s*=/i.test(tag)) {
      tag = tag.replace(/\sheight\s*=\s*"[^"]*"/i, ` height="${size.height}"`);
    } else {
      tag = tag.replace(/<svg\b/i, `<svg height="${size.height}"`);
    }

    // 4. 居中声明（宽高比一致时 meet 是恒等变换，纯粹是查看器兼容保险）
    if (/\spreserveAspectRatio\s*=/i.test(tag)) {
      tag = tag.replace(/\spreserveAspectRatio\s*=\s*"[^"]*"/i, ' preserveAspectRatio="xMidYMid meet"');
    } else {
      tag = tag.replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid meet"');
    }

    // 3. viewBox 重写为加留白后的坐标
    tag = tag.replace(/\sviewBox\s*=\s*"[^"]*"/i,
      ` viewBox="${vx - PAD} ${vy - PAD} ${vw + PAD * 2} ${vh + PAD * 2}"`);

    return svgText.replace(open[0], () => tag);
  }

  /**
   * 把内联 svg 块原位重写为 mermaid 围栏，并返回 mermaid_images 条目。
   * @returns {Promise<{markdown: string, images: Array<{key, svg, width, height}>}>}
   */
  async function prepareForWordExport(markdown) {
    const blocks = extractInlineSvgBlocks(markdown);
    if (!blocks.length) {
      return { markdown, images: [] };
    }

    // 量测全部 svg（key = 与 findMermaidBlocks 相同的归一化）
    const images = await Promise.all(
      blocks.map(async (b) => {
        const measured = await measureSvg(b.text);
        return { key: dedent(b.text).trim(), ...measured };
      })
    );

    // 按行倒序原位替换为围栏（倒序保证前面的行号不失效；重复 svg 也各自成围栏）
    const lines = String(markdown).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (let i = blocks.length - 1; i >= 0; i--) {
      const fenceLines = ['```mermaid'].concat(blocks[i].text.split('\n'), ['```']);
      lines.splice(blocks[i].startLine, blocks[i].endLine - blocks[i].startLine + 1, fenceLines.join('\n'));
    }

    return { markdown: lines.join('\n'), images };
  }

  return {
    dedent,
    extractInlineSvgBlocks,
    measureSvg,
    normalizeForExport,
    prepareForWordExport,
    _viewBoxSize: viewBoxSize
  };
});
