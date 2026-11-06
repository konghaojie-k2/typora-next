/**
 * Slides SVG Size — 幻灯片内联 <svg> 尺寸策略（纯函数，Node 可测）
 *
 * 问题背景（2026-11-05 实爆）：PPT 模式按 1280×720 固定装箱（页内容高
 * ≈634px），竖版内联 svg（viewBox 高>宽 + width="100%"）实测高度远超
 * 页高；装箱层无法拆分 svg，只能独占一页并允许溢出 → 播放时下半张被
 * 裁掉（展示不全）。主视图无此问题（正文可滚动）。
 *
 * 策略与 slides.js postProcessMermaidSvg 一致：
 *   有 viewBox → 剥 width/height 属性，满宽 + aspect-ratio + 页高封顶
 *                （preserveAspectRatio 默认 meet，封顶后图形完整居中）
 *   无 viewBox → 保留属性，max-width/max-height 兜底（无比例可算）
 *
 * 另切断外层字号级联：.reveal 根字号 28px（slides.css）会继承进 svg text，
 * 无内部 <style> 的插图按 ~16px 坐标排版 → 文本溢出盒子互相重叠（挤字）。
 * svg 根部锁定基准字号（主视图 --font-size-base = 16px）后，.ts/.th 类
 * 文本继承 16px 与主视图一致；自带 font-size 属性的文本不受影响。
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SlidesSvgSize = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  /**
   * @param {number} vbW - viewBox 宽（非法值走兜底分支）
   * @param {number} vbH - viewBox 高
   * @param {number} boxH - 幻灯片页内容高（contentBox().height）
   * @param {number} [baseFontSize=16] - svg 根部基准字号（px），切断 .reveal
   *        28px 字号级联进 svg text（挤字实爆 2026-11-05）
   * @returns {{stripSizeAttrs: boolean, styles: Object<string,string>}}
   *          styles 键为 camelCase，直接赋给 el.style
   */
  function inlineSvgSizing(vbW, vbH, boxH, baseFontSize) {
    var fs = (baseFontSize > 0 ? baseFontSize : 16) + 'px';
    if (vbW > 0 && vbH > 0) {
      return {
        stripSizeAttrs: true,
        styles: {
          display: 'block',
          width: '100%',
          height: 'auto',
          aspectRatio: vbW + ' / ' + vbH,
          maxHeight: boxH + 'px',
          margin: '0 auto',
          fontSize: fs
        }
      };
    }
    return {
      stripSizeAttrs: false,
      styles: {
        display: 'block',
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        maxHeight: boxH + 'px',
        margin: '0 auto',
        fontSize: fs
      }
    };
  }

  return { inlineSvgSizing: inlineSvgSizing };
});
