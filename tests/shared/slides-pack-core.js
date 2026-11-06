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
 * - 翻页落在 H2 小节中间时，下一页标记 continuedH2（调用方渲染"（续）"前缀），
 *   并记录 continuedH（标题高度）——新页预算扣除该高度，防止标题+满页内容
 *   溢出页底（实爆 2026-11-05）；调用方注入标题前应校验
 *   pageH + continuedH <= availH，超出（如超高 svg 独占页）则跳过标题
 */
function packItems(items, availH) {
  const pages = [];
  let cur = [];
  let curH = 0;
  // 当前（正在装填的）页的续节标记与预算：标记在页开始时确定，
  // 关闭页面时随页落盘（flush 前设置会被 flush 清掉，最后一页丢标记）
  let pageContinuedH2 = null;
  let pageContinuedH = 0;
  let pageBudget = availH;
  let currentH2 = null;
  let currentH2H = 0;      // 当前 H2 标题的实测高度

  function flushAndBegin(nextH2, nextH) {
    if (cur.length > 0) {
      pages.push({
        items: cur,
        continuedH2: pageContinuedH2,
        continuedH: pageContinuedH
      });
      cur = [];
      curH = 0;
    }
    pageContinuedH2 = nextH2 || null;
    pageContinuedH = pageContinuedH2 ? (nextH || 0) : 0;
    // 带"（续）"标题的新页预留标题高度，防标题+满页内容溢出页底（实爆 2026-11-05）
    pageBudget = pageContinuedH2 ? Math.max(0, availH - pageContinuedH) : availH;
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
      if (!loneHeading && curH + headingChainNeed(i) > pageBudget) {
        flushAndBegin(null, 0); // 标题从新页顶部开始（作为普通 item 计入）
      }
    }

    // 放得下：直接装入
    if (curH + item.height <= pageBudget) {
      cur.push(item);
      curH += item.height;
      if (item.h2Text) {
        currentH2 = item.h2Text;
        currentH2H = item.height;
      }
      i++;
      continue;
    }

    // 放不下：尝试拆分（空页时用整页高度，故翻页后会自然重试）
    if (item.split) {
      const parts = item.split(pageBudget - curH);
      if (parts) {
        cur.push(parts[0]);
        flushAndBegin(currentH2, currentH2H); // 拆分的剩余部分在同一小节内 → 续页
        items[i] = parts[1];
        continue;
      }
    }

    if (cur.length === 0) {
      // 空页 + 拆不动 + 超高 → 独占一页（设计允许的溢出）
      cur.push(item);
      curH += item.height;
      if (item.h2Text) {
        currentH2 = item.h2Text;
        currentH2H = item.height;
      }
      i++;
      continue;
    }

    // 非空页：翻页，循环用整页高度重试（修复：拆分不再因剩余空间小而被跳过）
    flushAndBegin(item.isHeading ? null : currentH2, item.isHeading ? 0 : currentH2H);
  }

  flushAndBegin(null, 0);
  return pages;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { packItems };
}
