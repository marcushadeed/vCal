// Runs runTests() locally, without clasp or the Apps Script editor:
//
//   TZ=America/New_York node dev/run-tests.js
//
// Only the stubs below exist in the sandbox, so a test that touches
// PropertiesService, Calendar, ScriptApp, LockService or CalendarApp fails with
// a ReferenceError instead of reaching anything real. config.js is never read:
// it holds personal calendar data.
//
// This file is under dev/, which .claspignore keeps out of Apps Script.

'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SKIPPED = ['config.js', 'config.example.js'];

// Apps Script's computeDigest() returns signed bytes.
function computeDigest(algorithm, text, charset) {
  if (algorithm !== 'MD5' || charset !== 'UTF_8') {
    throw new Error('Unsupported digest stub arguments');
  }
  const bytes = crypto.createHash('md5').update(text, 'utf8').digest();
  return Array.from(bytes, (byte) => (byte > 127 ? byte - 256 : byte));
}

function formatDate(date, timeZone, pattern) {
  if (pattern !== 'yyyy-MM-dd' && pattern !== 'yyyy-MM-dd HH:mm') {
    throw new Error('Unsupported formatDate stub pattern: ' + pattern);
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  formatter.formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });
  const day = parts.year + '-' + parts.month + '-' + parts.day;
  return pattern === 'yyyy-MM-dd' ? day : day + ' ' + parts.hour + ':' + parts.minute;
}

const context = vm.createContext({
  Logger: { log: (message) => console.log(String(message)) },
  console: console,
  Utilities: {
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: computeDigest,
    formatDate: formatDate,
  },
});

function checkPageScript() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('index.html has no inline script');
  }
  // Compiled only, never run: it needs a browser.
  new vm.Script(match[1], { filename: 'index.html' });
}

try {
  fs.readdirSync(ROOT)
    .filter((name) => name.endsWith('.js') && !SKIPPED.includes(name))
    .sort()
    .forEach((name) => {
      const code = fs.readFileSync(path.join(ROOT, name), 'utf8');
      vm.runInContext(code, context, { filename: name });
    });
  checkPageScript();
  vm.runInContext('runTests()', context, { filename: 'run-tests' });
} catch (e) {
  console.error(e.stack || String(e));
  process.exitCode = 1;
}
