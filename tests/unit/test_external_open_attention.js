#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for OS File-Association Open + Taskbar Attention
 *
 * Sprint 7: When the user double-clicks a .md in Explorer while the app
 * is in the background, the taskbar icon should flash so the user
 * notices the file opened.
 *
 * The handler is an inline IIFE callback in dist/scripts/main.js, so a
 * full unit test (loading main.js with a mock __TAURI__) is heavy.
 * Instead we test the *structural contract* of the source file:
 *   - listener registered for 'open-file-from-args'
 *   - inside the listener: open_file invoke → addTab → notify invoke
 *   - notify invoke is INSIDE the .then(success) branch (NOT after the .catch)
 *
 * This catches regressions where someone removes the notify call or
 * moves it out of the success branch (which would cause a flash even
 * when the file failed to open).
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('./test-runner');

const MAIN_JS = path.join(__dirname, '..', '..', 'dist', 'scripts', 'main.js');

function loadMainJs() {
  return fs.readFileSync(MAIN_JS, 'utf8');
}

function extractOpenFileFromArgsListenerBody(source) {
  // Match: listen('open-file-from-args', (event) => { ... });
  // The body may contain nested braces; use a depth counter to find the closing brace.
  const marker = "listen('open-file-from-args'";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('listen("open-file-from-args") not found in main.js');

  // Find the opening brace of the arrow function body
  const arrowIdx = source.indexOf('=>', start);
  const braceIdx = source.indexOf('{', arrowIdx);
  if (braceIdx < 0) throw new Error('Could not find arrow function body');

  let depth = 0;
  for (let i = braceIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceIdx + 1, i);
    }
  }
  throw new Error('Unterminated listener body');
}

// ============================================
// Listener registration
// ============================================

TestRunner.test('main.js registers a listener for open-file-from-args', () => {
  const source = loadMainJs();
  TestRunner.assert(
    source.includes("listen('open-file-from-args'"),
    'expected listen("open-file-from-args") call to exist in main.js'
  );
});

// ============================================
// Listener body structure
// ============================================

TestRunner.test('listener invokes open_file to read the file', () => {
  const body = extractOpenFileFromArgsListenerBody(loadMainJs());
  TestRunner.assert(
    /invoke\(\s*['"]open_file['"]/.test(body),
    'listener body must call invoke("open_file", ...) to read file content'
  );
});

TestRunner.test('listener calls addTab after open_file succeeds', () => {
  const body = extractOpenFileFromArgsListenerBody(loadMainJs());
  TestRunner.assert(
    /invoke\(\s*['"]open_file['"][\s\S]*?addTab\(/.test(body),
    'addTab must be called after invoke("open_file") (i.e. on success)'
  );
});

TestRunner.test('listener invokes notify_external_file_opened (Sprint 7)', () => {
  const body = extractOpenFileFromArgsListenerBody(loadMainJs());
  TestRunner.assert(
    /invoke\(\s*['"]notify_external_file_opened['"]/.test(body),
    'Sprint 7: listener must call invoke("notify_external_file_opened") for taskbar attention'
  );
});

TestRunner.test('notify invoke is positioned AFTER addTab (so flash comes after open)', () => {
  const body = extractOpenFileFromArgsListenerBody(loadMainJs());
  const addTabPos = body.indexOf('addTab(');
  const notifyPos = body.search(/invoke\(\s*['"]notify_external_file_opened['"]/);
  TestRunner.assert(addTabPos > -1, 'addTab call not found');
  TestRunner.assert(notifyPos > -1, 'notify_external_file_opened invoke not found');
  TestRunner.assert(
    notifyPos > addTabPos,
    'notify invoke must come after addTab (Sprint 7 design: addTab succeeds → then notify)'
  );
});

TestRunner.test('notify invoke is INSIDE the .then success branch (not after .catch)', () => {
  // The listener has: invoke('open_file').then(result => { ... addTab ... notify ... })
  //                                                       .catch(err => { ... })
  // We must verify notify is in the success path. We do this by checking
  // that the notify invoke string appears before the .catch( in the listener body.
  const body = extractOpenFileFromArgsListenerBody(loadMainJs());
  const catchPos = body.indexOf('.catch(');
  const notifyPos = body.search(/invoke\(\s*['"]notify_external_file_opened['"]/);
  TestRunner.assert(notifyPos > -1, 'notify_external_file_opened invoke not found');
  TestRunner.assert(
    catchPos < 0 || notifyPos < catchPos,
    'notify must be in the .then success branch, NOT after .catch (regression: U2)'
  );
});

TestRunner.test('notify invoke has a .catch handler so a failure does not pollute', () => {
  // invoke('notify_external_file_opened').catch(err => ...) — the call must
  // not be naked (otherwise a failed attention request becomes an unhandled
  // promise rejection on the main flow).
  const body = extractOpenFileFromArgsListenerBody(loadMainJs());

  // Find the notify invoke and check for a .catch right after it (allowing whitespace).
  const notifyMatch = body.match(/invoke\(\s*['"]notify_external_file_opened['"]\s*\)\s*\.catch\(/);
  TestRunner.assert(
    !!notifyMatch,
    'invoke("notify_external_file_opened") must be followed by .catch(...) to avoid unhandled rejection'
  );
});

// ============================================
// Run
// ============================================

if (require.main === module) {
  console.log('Running External Open + Taskbar Attention tests...\n');
  TestRunner.run();
}

module.exports = { extractOpenFileFromArgsListenerBody };
