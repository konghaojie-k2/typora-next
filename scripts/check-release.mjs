#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Validate and extract the app version's notes before building or publishing. */
export function validateRelease({ version, tag = '', changelog }) {
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('src-tauri/tauri.conf.json 缺少应用版本号');
  }
  if (tag && tag !== `v${version}`) {
    throw new Error(`发布标签 ${tag} 与应用版本 ${version} 不一致，应使用 v${version}`);
  }

  const markdown = changelog.replace(/\r\n?/g, '\n');
  // Comments cannot supply a version heading or count as release content.
  const visible = markdown.replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\n]/g, ' '));
  const headings = [...visible.matchAll(/^##[ \t]+([^\n]*)$/gm)];
  const sections = headings.flatMap((heading, index) => {
    const label = heading[1].match(/^\[([^\]]+)\](?:[ \t]|$)/);
    return label && label[1].replace(/^v/, '') === version ? [index] : [];
  });
  if (!sections.length) {
    throw new Error(`CHANGELOG.md 缺少版本 ${version} 的更新说明，请添加 ## [${version}] 条目`);
  }
  if (sections.length > 1) {
    throw new Error(`CHANGELOG.md 中版本 ${version} 的条目重复，请合并更新说明`);
  }

  const index = sections[0];
  const heading = headings[index];
  const end = headings[index + 1]?.index ?? markdown.length;
  const body = visible.slice(heading.index + heading[0].length, end);
  const hasContent = body.split('\n').some(line => {
    const text = line.trim();
    if (/^(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|\[[^\]]+\]:)/.test(text)) return false;
    const content = text.replace(/^(?:[-+*]|\d+[.)])\s+/, '').replace(/[*_`~]/g, '').trim();
    if (!/[\p{L}\p{N}]/u.test(content)) return false;
    return !/^(?:todo|tbd|n\/a|none|待补充|待填写|暂无(?:更新(?:内容)?)?)(?:$|[\s:：.。…])/i.test(content);
  });
  if (!hasContent) {
    throw new Error(`CHANGELOG.md 版本 ${version} 没有实际更新内容，不能只填写标题、注释或 TODO/TBD`);
  }

  return { version, notes: markdown.slice(heading.index, end).trim() + '\n' };
}

function main() {
  const { values } = parseArgs({ options: {
    tag: { type: 'string', default: '' },
    output: { type: 'string' }
  } });
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const result = validateRelease({
    version: config.version,
    tag: values.tag,
    changelog: readFileSync('CHANGELOG.md', 'utf8')
  });
  if (values.output) writeFileSync(values.output, result.notes);
  console.log(`Release Notes 检查通过：v${result.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`发布检查失败：${error.message}`);
    process.exitCode = 1;
  }
}
