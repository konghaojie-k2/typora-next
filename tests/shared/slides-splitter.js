#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Shared mirrored implementation of slides structure split (v3)
 * (must stay in sync with main.js parseMarkdownStructure)
 *
 * v3 (2026-07-26): 源码层只做结构切分，分页装箱移到 slides iframe
 * 渲染后按真实 DOM 高度测量（见 slides-pack-core.js / slides.js）。
 *
 * 结构层职责：
 * - 显式模式：--- = 横页硬边界，-- = 纵页硬边界（不再按预算拆分）
 * - 自动模式：H1 分章（封面页），H2 及内容原样保留在章节单元内
 * - YAML frontmatter / 代码围栏 / Setext 标题保护
 */

function isFenceLine(t) {
  return t.startsWith('```') || t.startsWith('~~~');
}

function isExplicitSeparator(lines, i) {
  // `---` 前必须是空行或文档开头（排除 Setext 二级标题）
  if (lines[i].trim() !== '---') return false;
  if (i === 0) return true;
  return lines[i - 1].trim() === '';
}

function skipYaml(lines) {
  if (lines.length > 0 && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') return i + 1;
    }
  }
  return 0;
}

function hasExplicitSeparators(lines) {
  let inCode = false;
  const start = skipYaml(lines);
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isFenceLine(t)) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (isExplicitSeparator(lines, i)) return true;
  }
  return false;
}

/**
 * 解析 markdown 为结构分组：
 * [{ cover: string|null, units: string[] }]
 * - cover：H1 封面（自动模式），显式模式为 null
 * - units：章节内容（自动模式整章一个单元）/ 显式模式的每个纵页单元
 */
function parseMarkdownStructure(content) {
  const lines = content.split('\n');
  if (hasExplicitSeparators(lines)) {
    return parseExplicitStructure(lines);
  }
  return parseAutoStructure(lines);
}

function parseExplicitStructure(lines) {
  const groups = [];
  let currentUnit = [];
  let currentUnits = [];
  let inCodeBlock = false;
  let inYaml = false;
  let yamlStarted = false;

  function flushUnit() {
    const text = currentUnit.join('\n').trim();
    if (text) currentUnits.push(currentUnit.join('\n'));
    currentUnit = [];
  }

  function flushGroup() {
    flushUnit();
    if (currentUnits.length > 0) {
      groups.push({ cover: null, units: currentUnits });
    }
    currentUnits = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (isFenceLine(t)) { inCodeBlock = !inCodeBlock; currentUnit.push(line); continue; }
    if (inCodeBlock) { currentUnit.push(line); continue; }

    if (!yamlStarted && t === '---' && currentUnit.length === 0 && currentUnits.length === 0 && groups.length === 0) {
      inYaml = true;
      yamlStarted = true;
      continue;
    }
    if (inYaml && t === '---') { inYaml = false; continue; }
    if (inYaml) continue;

    if (isExplicitSeparator(lines, i)) { flushGroup(); continue; }
    if (t === '--') { flushUnit(); continue; }
    currentUnit.push(line);
  }
  flushGroup();
  return groups;
}

function parseAutoStructure(lines) {
  const groups = [];
  let currentContent = [];
  let inCodeBlock = false;
  const start = skipYaml(lines);

  function flushGroup(cover) {
    const text = currentContent.join('\n').trim();
    if (text) {
      groups.push({ cover: cover, units: [currentContent.join('\n')] });
    } else if (cover) {
      groups.push({ cover: cover, units: [] });
    }
    currentContent = [];
  }

  let pendingCover = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (isFenceLine(t)) { inCodeBlock = !inCodeBlock; currentContent.push(line); continue; }
    if (inCodeBlock) { currentContent.push(line); continue; }

    if (/^#\s/.test(t)) {
      flushGroup(pendingCover);
      pendingCover = t;
      continue;
    }
    currentContent.push(line);
  }
  flushGroup(pendingCover);
  return groups;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseMarkdownStructure,
    hasExplicitSeparators,
    isFenceLine,
    isExplicitSeparator
  };
}
