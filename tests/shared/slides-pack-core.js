#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Shared slides pack core (v3) — 按测量高度装箱的纯逻辑。
 *
 * slides.js 把真实 DOM 元素包装成 item（含真实高度与拆分闭包）；
 * 测试用假 item（注入假高度）验证同样的装箱决策。
 *
 * item: {
 *   height: number,          // 含外边距的占位高度（px，slide 坐标系）
 *   isHeading: boolean,      // 标题元素（用于孤行标题规则）
 *   h2Text: string|null,     // H2 标题文本（用于续页前缀）
 *   payload: any,            // 调用方数据（真实 DOM 节点 / 测试标记）
 *   split: (remainingH:number) => [partItem, restItem] | null  // 可选拆分
 * }
 *
 * page: { items: item[], continuedH2: string|null }
 */

/**
 * 按可用高度装箱。
 * - 孤行标题规则：标题需连同"标题链 + 第一个非标题项"一起放得下，否则先翻页；
 *   当前页只剩孤标题时允许溢出（防死循环）
 * - 可拆分项：剩余空间放得下第一部分就先放，其余进下一页
 * - 不可拆且超高的项：独占一页（允许溢出）
 * - 翻页落在 H2 小节中间时，下一页标记 continuedH2（调用方渲染"（续）"前缀）
 */
function packItems(items, availH) {
  const pages = [];
  let cur = [];
  let curH = 0;
  let currentH2 = null;
  let nextContinuedH2 = null;

  function flush() {
    if (cur.length > 0) {
      pages.push({ items: cur, continuedH2: nextContinuedH2 });
      cur = [];
      curH = 0;
      nextContinuedH2 = null;
    }
  }

  // 标题链前瞻：返回标题项连同后续标题链+第一个非标题项的总高度
  function headingChainNeed(idx) {
    let need = 0;
    let j = idx;
    while (j < items.length && items[j].isHeading) {
      need += items[j].height;
      j++;
    }
    if (j < items.length) need += items[j].height;
    return need;
  }

  let i = 0;
  while (i < items.length) {
    const item = items[i];

    if (item.isHeading && cur.length > 0) {
      const loneHeading = cur.length === 1 && cur[0].isHeading;
      if (!loneHeading && curH + headingChainNeed(i) > availH) {
        flush();
      }
    }

    // 放得下：直接装入
    if (curH + item.height <= availH) {
      cur.push(item);
      curH += item.height;
      if (item.h2Text) currentH2 = item.h2Text;
      i++;
      continue;
    }

    // 放不下：尝试拆分（空页时用整页高度，故翻页后会自然重试）
    if (item.split) {
      const parts = item.split(availH - curH);
      if (parts) {
        cur.push(parts[0]);
        flush();
        // 拆分的剩余部分在同一小节内 → 续页
        nextContinuedH2 = currentH2;
        items[i] = parts[1];
        continue;
      }
    }

    if (cur.length === 0) {
      // 空页 + 拆不动 + 超高 → 独占一页（设计允许的溢出）
      cur.push(item);
      curH += item.height;
      if (item.h2Text) currentH2 = item.h2Text;
      i++;
      continue;
    }

    // 非空页：翻页，循环用整页高度重试（修复：拆分不再因剩余空间小而被跳过）
    const continuedFrom = currentH2;
    flush();
    nextContinuedH2 = item.isHeading ? null : continuedFrom;
  }

  flush();
  return pages;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { packItems };
}
