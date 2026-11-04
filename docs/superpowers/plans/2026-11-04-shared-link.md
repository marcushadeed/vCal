# Shared Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn vCal into one shared web-app link where each person sets up, previews and runs their own mirror on the page, with no code, editor or logs.

**Architecture:** Per-user settings and rules move from `config.js` and Script Properties to User Properties. `loadSettings()` fills the existing global `CONFIG` at the start of each entry point, so the sync's diff logic barely changes. Rule matching moves to plain local-time parts so each user's time zone applies.

**Tech Stack:** Google Apps Script (V8), advanced Calendar service v3, `HtmlService`, plain JS. A dependency-free Node script runs `runTests()` locally.

**Spec:** `docs/superpowers/specs/2026-11-04-shared-link-design.md`. Read it first, along with `CLAUDE.md`.

## Global Constraints

- No ES modules, `require()` or npm packages in pushed code. Every `.js` file shares one global namespace. Only `dev/` may use Node APIs, and `dev/` is never pushed.
- New code is plain ASCII.
- **Never run `clasp push`, `clasp deploy` or anything else that changes an Apps Script project.** `.clasp.json` points at Marcus's live project. Deployment is Task 8, which only Marcus does.
- **Never delete, read or print the local `config.js`.** It's gitignored, holds personal calendar IDs, and is the source for the migration.
- Logs and thrown errors must never contain event titles, calendar names, calendar IDs or rule text.
- Event text reaches the page through `textContent`, never `innerHTML`.
- Never copy attendees. Always clear reminders. Keep the start time in the sync key.
- `computeSyncKey()` keeps using `parseEventStart()` unchanged. Changing it would rebuild every mirror.
- An unreadable source calendar must fail the sync, never skip it, because skipping deletes its mirrored copies.
- Work on branch `shared-link`, and commit after each task. The branch isn't deployable until Task 7.

## Review Focus

Each has a test or a stated check in the owning task.

1. **An "Any title" rule with no limits** would empty the mirror at the next sync. `validateRule()` refuses it (Task 3).
2. **No source calendars** gives an empty desired state, so the diff would delete the whole mirror. `assertReadyToSync()` refuses to preview or sync (Task 4).
3. **A block made near midnight in a non-New York time zone** must match that same event and not its neighbours (Task 2).
4. **An unreadable stored rule** is deleted when rules load, so it can't block the sync or the page, and users never need an editor to fix it (Task 3).
5. **A mirror calendar deleted by hand** must show an error and offer **Create mirror calendar** again, while a mirror that still exists can't be replaced by a double click (Task 5).

---

### Task 1: Local test runner and always-defined `CONFIG`

**Files:**
- Create: `dev/run-tests.js`, `settings.js`
- Modify: `.claspignore`, `tests.js:159-162`

**Interfaces:**
- Produces: `var CONFIG = { mirrorCalendarId: '', sourceCalendars: [], rules: [], lookaheadDays: 180, timeZone: '' }` in `settings.js`.
- Produces: the command `TZ=America/New_York node dev/run-tests.js`, which exits non-zero on any failure.

- [ ] **Step 1: Create the branch and commit the spec and this plan**

```bash
git switch -c shared-link
git add docs/superpowers/specs/2026-11-04-shared-link-design.md docs/superpowers/plans/2026-11-04-shared-link.md
git commit -m "add shared link design and plan"
```

- [ ] **Step 2: Add `settings.js` with only the `CONFIG` declaration above, and add these lines to `.claspignore`**

```
dev/**
config.js
```

`config.js` must never reach the shared project, and it declares a conflicting `const CONFIG`.

- [ ] **Step 3: Write `dev/run-tests.js`**

Use only `node:vm`, `node:fs`, `node:path`, `node:crypto`. Create one VM context and run every root-level `*.js` file in it, sorted by name, skipping `config.js` and `config.example.js`. Then call `runTests()`, and set a non-zero exit code if it throws. Also compile the inline `<script>` from `index.html` with `new vm.Script` and fail on a syntax error, without running it.

Provide only these stubs, so a test touching `PropertiesService`, `Calendar`, `ScriptApp`, `LockService` or `CalendarApp` fails with a `ReferenceError`:
- `Logger.log` and `console`, printing to stdout.
- `Utilities.DigestAlgorithm.MD5`, `Utilities.Charset.UTF_8`, and `Utilities.computeDigest()`, returning an array of **signed** bytes like Apps Script does.
- `Utilities.formatDate(date, timeZone, pattern)`, supporting `yyyy-MM-dd` and `yyyy-MM-dd HH:mm` using `Intl.DateTimeFormat` with `hourCycle: 'h23'`.

- [ ] **Step 4: Remove the `typeof CONFIG === 'undefined'` guard from `testMatchesRules()`**

- [ ] **Step 5: Run the tests**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: every existing test passes, ending in `All tests passed.`

- [ ] **Step 6: Confirm the runner detects failure**

Temporarily change one `expected` value in `TEST_CASES` and run again. Expected: non-zero exit with `FAIL`. Revert the change.

- [ ] **Step 7: Commit**

```bash
git add dev/run-tests.js settings.js .claspignore tests.js
git commit -m "add local test runner and default CONFIG"
```

---

### Task 2: Match rules on local parts, and add `contains`

**Files:**
- Modify: `rules.js`, `blocks.js`, `sync.js` (`collectEvents`), `webapp.js` (`toPageEvent`, `classifyEvent`, `blockEvent`), `tests.js`

**Interfaces:**
- Produces, in `rules.js`:
  - `localStartParts(start, timeZone)`, where `start` is an API `{ date }` or `{ dateTime }`. Returns `{ date: 'YYYY-MM-DD', day: 'MO', minutes: Number, allDay: Boolean }`.
  - `describeStart(parts)`: `'2026-11-04 10:30'`, or `'2026-11-04'` when all-day.
  - `matchesRules(title, parts)`, `findMatchingRule(title, parts)`, `ruleMatches(rule, title, parts)`.
- Produces, in `blocks.js`: `buildBlockRule(scope, title, parts)`.
- `classifyEvent(title, parts, pageRules)` keeps working for now, and Task 5 removes it.

- [ ] **Step 1: Add a test helper and convert the existing tests**

Add `partsFromDate(date)` to `tests.js`. It returns local parts using the `Date` getters, so the existing fixtures keep their `new Date(...)` values. Change the calls in `testMatchesRules`, `testMalformedDateRules`, `storedRuleMatches`, `testBuildBlockRule`, `testClassifyEvent` and `testDescribeBlock` to pass parts. In `testParseEventStart`, replace the `formatDate(allDay)` case with `blockResult('start: an all-day date stays on the same local day', 25, allDay.getDate())`.

- [ ] **Step 2: Write the failing tests, and add `testLocalStartParts` and `testContainsRule` to `runTests()`**

```javascript
function testLocalStartParts() {
  var utc = { dateTime: '2026-11-04T15:30:00Z' };
  var ny = localStartParts(utc, 'America/New_York');
  var tokyo = localStartParts(utc, 'Asia/Tokyo');
  var dst = localStartParts({ dateTime: '2026-03-08T07:30:00Z' }, 'America/New_York');
  var offset = localStartParts({ dateTime: '2026-11-04T10:30:00-05:00' }, 'America/New_York');
  var allDayTokyo = localStartParts({ date: '2026-12-25' }, 'Asia/Tokyo');
  var allDayLa = localStartParts({ date: '2026-12-25' }, 'America/Los_Angeles');
  var nearMidnight = localStartParts({ dateTime: '2026-11-04T15:05:00Z' }, 'Asia/Tokyo');
  var block = buildBlockRule('occurrence', 'Late Call', nearMidnight);
  var run = function (startIso) {
    return withRules([block], function () {
      return matchesRules('Late Call', localStartParts({ dateTime: startIso }, 'Asia/Tokyo'));
    });
  };
  return [
    blockResult('parts: New York date', '2026-11-04', ny.date),
    blockResult('parts: New York minutes', 630, ny.minutes),
    blockResult('parts: New York day', 'WE', ny.day),
    blockResult('parts: Tokyo crosses to the next date', '2026-11-05', tokyo.date),
    blockResult('parts: Tokyo minutes', 30, tokyo.minutes),
    blockResult('parts: Tokyo day follows its date', 'TH', tokyo.day),
    blockResult('parts: daylight saving start', 210, dst.minutes),
    blockResult('parts: an offset timestamp is the same instant', 630, offset.minutes),
    blockResult('parts: a timed event is not all-day', false, ny.allDay),
    blockResult('parts: all-day keeps its date in Tokyo', '2026-12-25', allDayTokyo.date),
    blockResult('parts: all-day keeps its date in Los Angeles', '2026-12-25', allDayLa.date),
    blockResult('parts: all-day day code', 'FR', allDayLa.day),
    blockResult('parts: all-day minutes', 0, allDayLa.minutes),
    blockResult('parts: all-day flag', true, allDayLa.allDay),
    blockResult('parts: describes a timed start', '2026-11-04 10:30', describeStart(ny)),
    blockResult('parts: describes an all-day start', '2026-12-25', describeStart(allDayLa)),
    blockResult('parts: a block near midnight matches its own event', true, run('2026-11-04T15:05:00Z')),
    blockResult('parts: and not one a minute later', false, run('2026-11-04T15:06:00Z')),
    blockResult('parts: and not the same time a day earlier', false, run('2026-11-03T15:05:00Z')),
    throwsResult('parts: a malformed date is refused', function () { localStartParts({ date: '12/25/2026' }, 'Asia/Tokyo'); }),
    throwsResult('parts: a malformed dateTime is refused', function () { localStartParts({ dateTime: 'nope' }, 'Asia/Tokyo'); }),
  ];
}

function testContainsRule() {
  var parts = partsFromDate(new Date(2026, 10, 4, 10, 0));
  var rule = { type: 'contains', value: ' Exam ' };
  return [
    blockResult('contains: matches regardless of case', true, ruleMatches(rule, 'Final EXAM review', parts)),
    blockResult('contains: does not match other text', false, ruleMatches(rule, 'Lecture', parts)),
    blockResult('contains: respects its limits', false,
      ruleMatches({ type: 'contains', value: 'exam', days: ['TU'] }, 'Exam', parts)),
  ];
}
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: failure, because `localStartParts` isn't defined.

- [ ] **Step 4: Implement**

In `rules.js`: add `localStartParts()` and `describeStart()`. For `dateTime`, make one `Utilities.formatDate(date, timeZone, 'yyyy-MM-dd HH:mm')` call. Work out `day` from the date string with `Date.UTC` and `getUTCDay()`, so no time-zone conversion applies. Change the day, time and date matchers to read parts. Add `contains` to `ruleMatchesTitle()`, trimmed and case-insensitive. Remove `formatDate()`.

In `blocks.js`: `buildBlockRule()` uses `parts.date` and `parts.minutes`. `pruneExpiredBlocks()` gets today from `Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd')`.

In `sync.js` `collectEvents()`: match on `localStartParts(item.start, CONFIG.timeZone)`. Keep `parseEventStart(item.start)` as `startTime` for the sync key, and add `startLabel: describeStart(parts)` to included and excluded entries.

In `webapp.js`: `toPageEvent()` and `blockEvent()` use `localStartParts()`, with `startMs` from `parseEventStart()`.

- [ ] **Step 5: Run the tests in two time zones**

Run: `TZ=America/New_York node dev/run-tests.js && TZ=Asia/Tokyo node dev/run-tests.js`
Expected: both end in `All tests passed.`

- [ ] **Step 6: Commit**

```bash
git add rules.js blocks.js sync.js webapp.js tests.js
git commit -m "match rules on local time parts and add contains"
```

---

### Task 3: Rule validation and the per-user rule store

**Files:**
- Modify: `rules.js`, `blocks.js`, `sync.js` (delete `describeRule`), `webapp.js`, `tests.js`

**Interfaces:**
- Produces, in `rules.js` (pure):
  - `validateRule(rule)`: throws on an invalid rule, returns nothing.
  - `normalizeRule(rule)`: returns a copy with keys in the order `type, value, flags, days, time, date`, unknown keys dropped, empty `flags` dropped, and `days` in `DAY_CODES` order.
  - `compileRule(storedRule)`: returns a rule whose regex `value` is a `RegExp`.
- Produces, in `blocks.js`:
  - `RULE_KEY_PREFIX = 'rule:'`
  - `parseStoredRule(json)` (pure): returns the validated stored rule, or `null` if it's unreadable or invalid.
  - `describeRule(rule)` (pure): replaces `describeBlock()`, and accepts a stored or compiled rule.
  - `loadStoredRules()` returns `[{ key, rule }]`, deleting any unreadable rule it finds. `loadRules()` returns compiled rules.
  - `addRule(rule)`, `replaceRule(oldKey, rule)`, `removeRule(key)`, `pruneExpiredRules(today)`.

All store functions use `getUserProperties()`.

- [ ] **Step 1: Write the failing tests, and add them to `runTests()`**

```javascript
function testValidateRule() {
  var bad = [
    ['an unknown type', { type: 'fuzzy', value: 'a' }],
    ['an empty contains', { type: 'contains', value: '  ' }],
    ['an empty regex', { type: 'regex', value: '' }],
    ['an invalid regex', { type: 'regex', value: '(' }],
    ['the g flag', { type: 'regex', value: 'a', flags: 'g' }],
    ['the y flag', { type: 'regex', value: 'a', flags: 'y' }],
    ['a blank exact title with no date', { type: 'exact', value: ' ' }],
    ['any title with no limits', { type: 'regex', value: '.*' }],
    ['an unknown day', { type: 'exact', value: 'a', days: ['XX'] }],
    ['empty days', { type: 'exact', value: 'a', days: [] }],
    ['a malformed time', { type: 'exact', value: 'a', time: { start: '9am', end: '10:00' } }],
    ['an impossible time', { type: 'exact', value: 'a', time: { start: '25:00', end: '26:00' } }],
    ['a time with start after end', { type: 'exact', value: 'a', time: { start: '10:00', end: '09:00' } }],
    ['a time with start equal to end', { type: 'exact', value: 'a', time: { start: '09:00', end: '09:00' } }],
    ['a malformed date', { type: 'exact', value: 'a', date: { start: '12/25/2026', end: '12/25/2026' } }],
    ['an impossible date', { type: 'exact', value: 'a', date: { start: '2026-02-31', end: '2026-02-31' } }],
    ['a date with start after end', { type: 'exact', value: 'a', date: { start: '2026-12-26', end: '2026-12-25' } }],
  ];
  var good = [
    ['exact', { type: 'exact', value: 'Lecture' }],
    ['contains', { type: 'contains', value: 'exam' }],
    ['case-insensitive regex', { type: 'regex', value: '^Lab', flags: 'i' }],
    ['any title with a date', { type: 'regex', value: '.*', date: { start: '2026-12-25', end: '2026-12-25' } }],
    ['any title with days', { type: 'regex', value: '.*', days: ['SA', 'SU'] }],
    ['an untitled occurrence', { type: 'exact', value: '', date: { start: '2026-11-04', end: '2026-11-04' }, time: { start: '10:00', end: '10:01' } }],
    ['a window ending at 24:00', { type: 'exact', value: 'a', time: { start: '23:59', end: '24:00' } }],
  ];
  var leaked = 'no error';
  try {
    validateRule({ type: 'exact', value: 'PRIVATE-TITLE', date: { start: 'PRIVATE-DATE', end: 'PRIVATE-DATE' } });
  } catch (e) {
    leaked = e.message.indexOf('PRIVATE') === -1 ? 'clean' : 'leaked';
  }
  return bad.map(function (c) {
    return throwsResult('validate: refuses ' + c[0], function () { validateRule(c[1]); });
  }).concat(good.map(function (c) {
    validateRule(c[1]);
    return blockResult('validate: accepts ' + c[0], true, true);
  })).concat([blockResult('validate: errors do not repeat the rule', 'clean', leaked)]);
}

function testNormalizeAndCompileRule() {
  var a = normalizeRule({ days: ['MO', 'SU'], value: 'a', extra: 1, flags: '', type: 'contains' });
  var b = normalizeRule({ type: 'contains', value: 'a', days: ['SU', 'MO'] });
  var parts = partsFromDate(new Date(2026, 10, 4, 10, 0));
  var compiled = compileRule(JSON.parse(JSON.stringify({ type: 'regex', value: '^lab', flags: 'i' })));
  return [
    blockResult('normalize: equal rules give the same JSON', JSON.stringify(b), JSON.stringify(a)),
    blockResult('normalize: days follow DAY_CODES order', 'SU,MO', a.days.join(',')),
    blockResult('normalize: unknown keys are dropped', false, 'extra' in a),
    blockResult('compile: a stored regex matches', true, ruleMatches(compiled, 'LAB 3', parts)),
    blockResult('compile: repeat matches stay true', true, ruleMatches(compiled, 'LAB 3', parts)),
    blockResult('compile: an exact rule is unchanged', 'x', compileRule({ type: 'exact', value: 'x' }).value),
  ];
}

function testParseStoredRule() {
  return [
    blockResult('stored: reads a valid rule', 'a', parseStoredRule('{"type":"exact","value":"a"}').value),
    blockResult('stored: corrupt JSON is unreadable', null, parseStoredRule('{ not json')),
    blockResult('stored: a rule that fails validation is unreadable', null, parseStoredRule('{"type":"regex","value":"("}')),
  ];
}

function testDescribeRule() {
  var limits = { days: ['MO', 'WE'], time: { start: '09:00', end: '10:00' } };
  var withLimits = { type: 'exact', value: 'Standup', days: limits.days, time: limits.time };
  var range = { type: 'regex', value: '.*', date: { start: '2026-12-21', end: '2027-01-01' } };
  return [
    blockResult('describe: contains', 'Titles containing "exam"', describeRule({ type: 'contains', value: 'exam' })),
    blockResult('describe: stored regex', 'Titles matching /^Lab/i', describeRule({ type: 'regex', value: '^Lab', flags: 'i' })),
    blockResult('describe: compiled regex', 'Titles matching /^Lab/i', describeRule(compileRule({ type: 'regex', value: '^Lab', flags: 'i' }))),
    blockResult('describe: limits', 'All events titled "Standup", on MO, WE, from 09:00 to 10:00', describeRule(withLimits)),
    blockResult('describe: any title with a range', 'All events, 2026-12-21 to 2027-01-01', describeRule(range)),
  ];
}
```

Rename `testDescribeBlock` to `testDescribeOccurrenceRule` and point it at `describeRule()`. Its three existing expected strings stay the same. An occurrence is a rule whose date start equals its end and whose time window is one minute.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: failure, because `validateRule` isn't defined.

- [ ] **Step 3: Implement the pure functions in `rules.js` and `blocks.js`**

`validateRule()` throws short fixed messages such as `'Enter a title.'` and `'The end date must not be before the start date.'`. It applies the blank-title rule to `exact` only when no `date` is set. Valid `flags` are `''` or `'i'`, and valid times are `00:00` to `24:00`. It detects a real date by round-tripping through `Date.UTC`. "Any title" means regex `.*` with no flags.

Delete `describeRule()` from `sync.js`. `logDryRun()` still calls it until Task 4 removes that, which no test exercises.

- [ ] **Step 4: Implement the store in `blocks.js`**

The key is `RULE_KEY_PREFIX + md5Hex(JSON.stringify(normalizeRule(rule)))`. `addRule()` validates and normalizes first. `replaceRule()` adds the new rule, then removes the old. `removeRule()` keeps its prefix check. `loadStoredRules()` deletes only `rule:` keys where `parseStoredRule()` returns `null`, and logs just the number deleted, never the content. Delete `BLOCK_KEY_PREFIX`, `loadBlocks`, `loadBlockRules`, `addBlock`, `removeBlock` and `pruneExpiredBlocks`, and update their callers in `sync.js` and `webapp.js`.

- [ ] **Step 5: Run the tests**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: `All tests passed.`

- [ ] **Step 6: Commit**

```bash
git add rules.js blocks.js sync.js webapp.js tests.js
git commit -m "add rule validation and per-user rule store"
```

---

### Task 4: Settings, sync lifecycle and log privacy

**Files:**
- Modify: `settings.js`, `sync.js`, `tests.js`
- Delete: `config.example.js`

**Interfaces:**
- Produces, in `settings.js`:
  - `FREQUENCY_HOURS = { daily: 24, every6h: 6, hourly: 1 }`
  - Pure: `assertSafeMirror(mirrorCalendarId, primaryCalendarId, sourceCalendars)`, `assertReadyToSync(settings)`, `isRunStale(settings, status, nowMs)`, `validateLookaheadDays(days)` (returns an integer from 1 to 365, or throws), `validateSources(sources, mirrorCalendarId)` (returns cleaned `{ id, name, color? }` entries, or throws).
  - `loadStoredSettings()` returns `{ mirrorCalendarId: '', sourceCalendars: [], lookaheadDays: 180, previewed: false, enabled: false, enabledAt: '', frequency: 'daily' }`, merged with what's stored. `enabledAt` is an addition to the spec, used for the stale check before a first run.
  - `saveStoredSettings(settings)`, `loadStatus()`, `recordStatus(status)`.
  - `loadSettings()`: fills `CONFIG` from storage, plus `CONFIG.timeZone` and the safety check from one `Calendar.Calendars.get('primary')` call, plus `CONFIG.rules = loadRules()`. Returns the stored settings.
- Produces, in `sync.js`:
  - `buildSyncPlan(startedAt)` returns `{ plan, excluded }`.
  - `mirrorCalendarSync()`: the trigger entry point.
  - `runSync()`: returns the status, or `null` when another run holds the lock. Rethrows failures.
  - Pure: `summarizePlan(plan, excluded)`, `describeRunError(e)`, `tagSourceError(e, sourceName)`.
- Status shape: `{ lastRunAt: ISO string, created, updated, deleted, unchanged, deferred, error: '' }`, or with `error` set and zero counts.

- [ ] **Step 1: Write the failing tests, and add them to `runTests()`**

```javascript
function testAssertSafeMirror() {
  var sources = [{ id: 'a@x', name: 'A' }];
  assertSafeMirror('mirror@x', 'me@x', sources);
  return [
    blockResult('mirror: a separate calendar is allowed', true, true),
    throwsResult('mirror: the primary calendar is refused', function () { assertSafeMirror('me@x', 'me@x', sources); }),
    throwsResult('mirror: the primary alias is refused', function () { assertSafeMirror('primary', 'me@x', sources); }),
    throwsResult('mirror: a source calendar is refused', function () { assertSafeMirror('a@x', 'me@x', sources); }),
  ];
}

function testAssertReadyToSync() {
  assertReadyToSync({ mirrorCalendarId: 'm@x', sourceCalendars: [{ id: 'a@x', name: 'A' }] });
  return [
    blockResult('ready: a mirror and a source are enough', true, true),
    throwsResult('ready: no mirror is refused', function () {
      assertReadyToSync({ mirrorCalendarId: '', sourceCalendars: [{ id: 'a@x', name: 'A' }] });
    }),
    // An empty desired state would delete everything in the mirror.
    throwsResult('ready: no sources is refused', function () {
      assertReadyToSync({ mirrorCalendarId: 'm@x', sourceCalendars: [] });
    }),
  ];
}

function testIsRunStale() {
  var hour = 60 * 60 * 1000;
  var now = Date.UTC(2026, 10, 10, 12, 0, 0);
  var ago = function (hours) { return new Date(now - hours * hour).toISOString(); };
  var on = function (frequency) { return { enabled: true, frequency: frequency, enabledAt: ago(1000) }; };
  return [
    blockResult('stale: daily at 48 hours is fine', false, isRunStale(on('daily'), { lastRunAt: ago(48) }, now)),
    blockResult('stale: daily at 50 hours is stale', true, isRunStale(on('daily'), { lastRunAt: ago(50) }, now)),
    blockResult('stale: every 6 hours at 12.5 hours is fine', false, isRunStale(on('every6h'), { lastRunAt: ago(12.5) }, now)),
    blockResult('stale: every 6 hours at 13.5 hours is stale', true, isRunStale(on('every6h'), { lastRunAt: ago(13.5) }, now)),
    blockResult('stale: hourly at 2.5 hours is fine', false, isRunStale(on('hourly'), { lastRunAt: ago(2.5) }, now)),
    blockResult('stale: hourly at 3.5 hours is stale', true, isRunStale(on('hourly'), { lastRunAt: ago(3.5) }, now)),
    blockResult('stale: paused is never stale', false,
      isRunStale({ enabled: false, frequency: 'hourly', enabledAt: '' }, { lastRunAt: ago(1000) }, now)),
    // Turning sync back on after a long pause must not warn straight away.
    blockResult('stale: a recent turn-on outweighs an old run', false,
      isRunStale({ enabled: true, frequency: 'daily', enabledAt: ago(1) }, { lastRunAt: ago(1000) }, now)),
    blockResult('stale: no run yet counts from turning on', false,
      isRunStale({ enabled: true, frequency: 'daily', enabledAt: ago(1) }, null, now)),
    blockResult('stale: no run long after turning on is stale', true,
      isRunStale({ enabled: true, frequency: 'daily', enabledAt: ago(60) }, null, now)),
  ];
}

function testSettingsValidators() {
  var cleaned = validateSources([{ id: 'a@x', name: ' A ', color: 5, extra: 1 }, { id: 'b@x', name: '' }], 'm@x');
  return [
    blockResult('lookahead: accepts a valid number', 90, validateLookaheadDays('90')),
    throwsResult('lookahead: refuses zero', function () { validateLookaheadDays(0); }),
    throwsResult('lookahead: refuses a fraction', function () { validateLookaheadDays(1.5); }),
    throwsResult('lookahead: refuses too many days', function () { validateLookaheadDays(366); }),
    throwsResult('lookahead: refuses text', function () { validateLookaheadDays('soon'); }),
    blockResult('sources: names are trimmed', 'A', cleaned[0].name),
    blockResult('sources: colours are normalised', '5', cleaned[0].color),
    blockResult('sources: unknown keys are dropped', false, 'extra' in cleaned[0]),
    blockResult('sources: an empty name falls back to Calendar', 'Calendar', cleaned[1].name),
    throwsResult('sources: a missing id is refused', function () { validateSources([{ name: 'A' }], 'm@x'); }),
    throwsResult('sources: an invalid colour is refused', function () { validateSources([{ id: 'a@x', name: 'A', color: '12' }], 'm@x'); }),
    throwsResult('sources: the mirror is refused', function () { validateSources([{ id: 'm@x', name: 'M' }], 'm@x'); }),
  ];
}

function testRunErrorDescriptions() {
  var tagged = tagSourceError(new Error('Not Found'), 'Work');
  return [
    blockResult('error: names the calendar for the page', 'Could not read "Work": Not Found', describeRunError(tagged)),
    // This message reaches the owner's logs when rethrown.
    blockResult('error: the rethrown message has no calendar name', 'Not Found', tagged.message),
    blockResult('error: other errors are unchanged', 'Boom', describeRunError(new Error('Boom'))),
  ];
}

function testSummarizePlan() {
  var plan = {
    creates: [{ title: 'New', startLabel: '2026-11-04 10:00', sourceName: 'A' }],
    updates: [{ desired: { title: 'Changed', startLabel: '2026-11-05', sourceName: 'A' } }],
    deletes: [
      { title: 'Old', start: '2026-11-06', sourceName: 'A', syncKey: 'k' },
      { title: 'Manual', start: '2026-11-07', sourceName: 'unknown' },
    ],
    unchanged: 7,
  };
  var excluded = [{ title: 'Skip', startLabel: '2026-11-08', sourceName: 'B', rule: { type: 'contains', value: 'skip' } }];
  var summary = summarizePlan(plan, excluded);
  return [
    blockResult('summary: counts', '1,1,2,7,1', [summary.counts.creates, summary.counts.updates, summary.counts.deletes,
      summary.counts.unchanged, summary.counts.excluded].join(',')),
    blockResult('summary: create start', '2026-11-04 10:00', summary.creates[0].start),
    blockResult('summary: update title', 'Changed', summary.updates[0].title),
    blockResult('summary: delete reason for a tracked event', 'No longer in a source calendar, or now excluded by a rule', summary.deletes[0].reason),
    blockResult('summary: delete reason for an untracked event', 'Not created by vCal', summary.deletes[1].reason),
    blockResult('summary: exclude reason names the rule', 'Titles containing "skip"', summary.excludes[0].reason),
  ];
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: failure, because `assertSafeMirror` isn't defined.

- [ ] **Step 3: Implement `settings.js`**

`isRunStale()` compares against the later of `status.lastRunAt` and `settings.enabledAt`, and is stale past `(2 * FREQUENCY_HOURS[frequency] + 1)` hours. `assertSafeMirror()` also refuses `'primary'`. Settings are one `settings` User Property and status is one `status` User Property, both JSON.

- [ ] **Step 4: Rework `sync.js`**

- Delete `DRY_RUN`, `logDryRun()`, `describeColor()` and the `CONFIG` undefined check. Keep `EVENT_COLOR_NAMES`.
- `desired[syncKey]` carries `startLabel`.
- In `collectEvents()`, wrap each calendar's read in `try { ... } catch (e) { throw tagSourceError(e, source.name); }`. It always rethrows.
- `buildSyncPlan(startedAt)` holds the shared steps from `mirrorCalendarSync()` up to `buildPlan()`.
- `runSync()` takes `LockService.getUserLock()` with `tryLock(0)`, and returns `null` without error if it can't get it. Inside a `try`, it calls `loadSettings()`, `assertReadyToSync()`, `buildSyncPlan()` and `applyPlan()`, then records the status. In `catch`, it records `error: describeRunError(e)` and rethrows `e`. It releases the lock in `finally`.
- `mirrorCalendarSync()` calls `loadStoredSettings()`, returns immediately if `enabled` is false, and otherwise calls `runSync()`.
- `applyPlan()` and `finishRun()` return the counts.

- [ ] **Step 5: Remove calendar content from logs**

Remove the title, source and calendar-name text from every log line in `sync.js`, including the colour warning and the `logTiming` labels. Use a calendar number where a label is needed. Delete the per-event `CREATE`, `UPDATE` and `DELETE` log lines.

Run: `grep -nE "Logger\.log|console\.log|logTiming\(" *.js | grep -E "title|\.name|sourceName|summary|mirrorCalendarId|\.id\b|rule"`
Expected: no output.

- [ ] **Step 6: Delete `config.example.js`, then run the tests**

Run: `git rm config.example.js && TZ=America/New_York node dev/run-tests.js`
Expected: `All tests passed.`

- [ ] **Step 7: Commit**

```bash
git add settings.js sync.js tests.js
git commit -m "load per-user settings, record run status and remove calendar text from logs"
```

---

### Task 5: Page actions and manifest

**Files:**
- Modify: `webapp.js`, `tests.js`, `appsscript.json`, `.gitignore`

**Interfaces:**
- Consumes: everything from Tasks 2 to 4.
- Produces, for the page, via `google.script.run`. Every function except `doGet` first calls `loadSettings()`:
  - `getPageData()` returns:
    ```
    { timeZone, settings: { mirrorCalendarId, mirrorMissing, sourceCalendars, lookaheadDays, previewed, enabled, frequency },
      status, stale, calendars: [{ id, name }], rules: [{ key, rule, description }],
      events: [{ title, start, startMs, allDay, day, time, sourceName, blocked }],
      colors: [{ id, name }], warnings: [] }
    ```
  - `createMirrorCalendar()`, `saveSources(sources)`, `saveLookaheadDays(days)`
  - `saveRule(rule, oldKey)`, where `oldKey` is `null` when adding. `deleteRule(key)`
  - `blockEvent(scope, title, start, allDay)`
  - `previewSync()` returns `{ preview: summarizePlan(...) }` or `{ error: describeRunError(e) }`. It sets `previewed` on success.
  - `turnOnSync(frequency)`, `pauseSync()`
  - `syncNow()` returns `{ status }`, catching failures because `runSync()` has already recorded them.
- Produces, pure: `isMirrorMissing(mirrorCalendarId, calendars)`, where `calendars` is the unfiltered list.

- [ ] **Step 1: Write the failing test, and add it to `runTests()`**

```javascript
function testIsMirrorMissing() {
  var calendars = [{ id: 'm@x' }, { id: 'a@x' }];
  return [
    blockResult('mirror: no mirror set is not missing', false, isMirrorMissing('', calendars)),
    blockResult('mirror: a listed mirror is not missing', false, isMirrorMissing('m@x', calendars)),
    blockResult('mirror: a deleted mirror is missing', true, isMirrorMissing('gone@x', calendars)),
  ];
}
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: failure, because `isMirrorMissing` isn't defined.

- [ ] **Step 3: Implement `webapp.js`**

- `listUserCalendars()` pages through `Calendar.CalendarList.list`, and maps to `{ id, name: summaryOverride || summary }`.
- `getPageData()` calls `pruneExpiredRules()` with today in the user's time zone. It leaves the mirror out of `calendars`. It only reads events once a mirror and at least one source are set. Unreadable calendars still become `warnings`, which go only to the page. `events[].blocked` is `matchesRules(title, parts)`. `colors` comes from `EVENT_COLOR_NAMES`.
- Delete `classifyEvent()` and `testClassifyEvent`.
- `createMirrorCalendar()` throws if a mirror is set and not missing. Otherwise it calls `Calendar.Calendars.insert({ summary: 'vCal mirror', timeZone: CONFIG.timeZone })` and saves the new id.
- `saveSources()` uses `validateSources()`.
- `previewSync()` and `syncNow()` call `assertReadyToSync()`. `syncNow()` and `turnOnSync()` throw unless `previewed` is true.
- `turnOnSync()` refuses a frequency not in `FREQUENCY_HOURS`, removes the user's existing `mirrorCalendarSync` triggers, and creates one with `ScriptApp.newTrigger('mirrorCalendarSync').timeBased()`: `.everyDays(1)` for daily, `.everyHours(6)` or `.everyHours(1)` otherwise. It then saves `enabled: true`, `enabledAt` and `frequency`.
- `pauseSync()` removes those triggers and clears `enabled`.
- Update the header comment. The page now runs as each user.

- [ ] **Step 4: Track the manifest**

Remove `appsscript.json` from `.gitignore`, and set its contents to:

```json
{
  "timeZone": "America/New_York",
  "oauthScopes": [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Calendar", "serviceId": "calendar", "version": "v3" }
    ]
  },
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "ANYONE"
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

- [ ] **Step 5: Run the tests**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: `All tests passed.`

- [ ] **Step 6: Commit**

```bash
git add webapp.js tests.js appsscript.json .gitignore
git commit -m "add page actions for setup and sync, and track the manifest"
```

---

### Task 6: The page

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: the Task 5 functions.

No automated tests cover the DOM. The runner checks the script compiles, and Task 8 covers behaviour.

- [ ] **Step 1: Rewrite the page body and script**

Keep the existing CSS tokens, `el()`, `button()`, `clear()`, `callServer()`, `act()` and the reload-after-action pattern. Set the heading to `vCal`.

**Setup panel**, shown until `settings.enabled` is true or `status` exists, with these steps in order:
1. **Create mirror calendar** button, shown when there's no mirror.
2. Source picker: a checkbox per calendar, an editable name defaulting to the calendar's name, and a colour dropdown including "Calendar default". A **Save calendars** button.
3. Add rules (optional), using the rule form below.
4. **Preview** button.
5. A frequency dropdown and a **Turn on sync** button, disabled until `settings.previewed`.

**Main sections**, shown after setup:
- **Status:** sync on or paused, frequency, last run time, counts, deferred changes and `status.error`. Buttons: **Preview**, **Sync now**, **Turn on sync** or **Pause**. When `stale` is true, show this warning: `vCal hasn't recorded a sync when one was expected. The app may be unavailable, so ask its owner to check it.`
- **Calendars:** the source picker, a lookahead number field with a save button, and **Create mirror calendar** with an explanation when `mirrorMissing` is true.
- **Rules:** one row per rule with its description and **Edit** and **Delete** buttons, plus the rule form.
- **Upcoming:** the existing search and day grouping. A blocked event shows `blocked by a rule`, with no action buttons. Others keep **Block this** and **Block all titled this**, with the untitled-event restriction.

**Rule form:** a match dropdown with Exact title, Title contains, Regex (advanced) and Any title. A text field, hidden for Any title. A case-insensitive checkbox, shown only for Regex. Seven day checkboxes, time start and end fields, and date start and end fields, all optional. Any title sends `{ type: 'regex', value: '.*' }`. **Edit** fills the form and passes the old key to `saveRule()`. Server validation errors appear in the existing error banner, and the form keeps what the user typed.

**Preview results** stay in a page variable and aren't reloaded. Show the five counts, then expandable lists of creates, updates, deletes and excludes with title (`(untitled)` when empty), start, source and reason. If the result has `error`, show it in the banner. Deletes come first when there are any.

**Long calls:** **Preview** and **Sync now** can take minutes, so show `Working. This can take a few minutes.` and disable the buttons while they run.

**Disclosure**, always visible at the bottom:

> vCal runs on its owner's Apps Script project. The owner can see when your syncs ran, and controls the code that can read and change your calendars. Google's error messages, which the owner can see, may include calendar IDs.

**Failures:** when the first load fails, append to the banner: `If you're signed in to more than one Google account, try an incognito window or sign out of the others.`

All calendar and rule text uses `textContent`.

- [ ] **Step 2: Run the runner's syntax check and the tests**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: `All tests passed.`

- [ ] **Step 3: Check that no HTML injection was introduced**

Run: `grep -n "innerHTML\|insertAdjacentHTML\|document.write" index.html`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "rebuild the page around setup, rules and sync status"
```

---

### Task 7: Docs and migration snippets

**Files:**
- Create: `dev/export-settings.js`, `dev/import-settings.js`
- Modify: `README.md`, `CLAUDE.md`, top comment of `sync.js`, top comment of `tests.js`, top comment of `blocks.js`

- [ ] **Step 1: Write the migration snippets**

Neither file holds personal data, and Marcus pastes them into the editor in Task 8.

- `dev/export-settings.js`: `exportSettings()` for the **old** project. Logs one JSON string of `{ settings: { mirrorCalendarId, sourceCalendars, lookaheadDays }, rules: [...] }`, combining `CONFIG.rules` and every `block:` Script Property. Regex values become their `.source` and `.flags` text, with `g` and `y` removed.
- `dev/import-settings.js`: `importSettings(json)` for the **new** project. Saves the settings with `previewed` and `enabled` false, and adds each rule with `addRule()`, so an invalid rule stops the import with an error.

- [ ] **Step 2: Rewrite `README.md`**

**User guide**, first and short: open the link, get past the unverified-app warning, follow the setup, preview, turn on. Include the rule types, the mirror being owned by vCal (anything added by hand gets deleted), the disclosure text from Task 6, the multiple-account limitation, and how to stop: **Pause**, then remove access at Google account connections.

**Deployer guide:** the clasp install, enabling the Apps Script API, a **new** project, deploying and updating, plus these warnings:
- Set the project to **Anyone with the link: Viewer**. Turning it off breaks every user's sync with no recorded error.
- Never push anything personal, since viewers can read the code.
- A deployment reaches every user's next run, so run the tests and try a separate test deployment first.
- `clasp create` overwrites `appsscript.json`, so restore it with `git checkout appsscript.json`. Use `clasp push --force`.
- The 100-user lifetime cap for unverified apps.

Add `TZ=America/New_York node dev/run-tests.js` as the local test command.

- [ ] **Step 3: Update `CLAUDE.md`**

- **Runtime:** the local runner is allowed under `dev/`, and is never pushed.
- **Filter Logic:** the new `matchesRules(title, parts)` signature, and `contains`.
- **Dry Run Mode:** replace with Preview and the sync lifecycle.
- **Time-Based Filtering:** rules now come from the page, and regex values are stored as text.
- **Page-Made Blocks:** replace with the rule store, including `rule:` keys, User Properties and `validateRule()`. Replace "A corrupt stored block throws" with: unreadable rules are deleted on load, because users have no editor to repair them.
- **Testing:** add the new pure functions and the runner.
- **Scheduled Trigger:** replace "Do not set the trigger in code" with the page creating each user's trigger.
- **Gotcha 4:** the page's Preview replaces the dry-run advice.
- **Configuration:** replace with per-user settings. The manifest must stay `USER_ACCESSING` and `ANYONE`, and the project must stay link-viewable.
- **Debugging:** logs must never contain event titles, calendar names, calendar IDs or rule text, because the owner can read every user's logs. Replace "Use `Logger.log()` liberally" with this.

- [ ] **Step 4: Update the stale comments in `sync.js`, `tests.js` and `blocks.js`**

Run: `grep -nE "DRY_RUN|config\.js|config\.example|do not add the trigger|Script Properties|CalendarApp" *.js index.html CLAUDE.md README.md`
Expected: only intended mentions, such as `config.js` in the migration notes and "Don't read source events through `CalendarApp`".

- [ ] **Step 5: Run the tests**

Run: `TZ=America/New_York node dev/run-tests.js`
Expected: `All tests passed.`

- [ ] **Step 6: Commit**

```bash
git add dev/export-settings.js dev/import-settings.js README.md CLAUDE.md sync.js tests.js blocks.js
git commit -m "document the shared link and add migration snippets"
```

---

### Task 8: Migrate and verify (Marcus only)

An agent must not do this task. Hand it to Marcus with the results of Tasks 1 to 7.

- [ ] **Step 1: Export from the old project.** Paste `dev/export-settings.js` into the old project's editor, run `exportSettings`, and copy the JSON. Remove the snippet afterwards.
- [ ] **Step 2: Create the new project with link sharing off.** Move the current `.clasp.json` aside, run `clasp create --type standalone --title vCal`, run `git checkout appsscript.json`, confirm `clasp status` does **not** list `config.js`, then run `clasp push --force`.
- [ ] **Step 3: Run the tests in the editor.** Run `runTests`, and accept the permission prompts. Expected: `All tests passed.`
- [ ] **Step 4: Import.** In the editor, paste `dev/import-settings.js` and a temporary function calling `importSettings` with the JSON, and run it. Delete both from the editor and save. **Do this before the first deployment.** Confirm no personal data remains in the project's code.
- [ ] **Step 5: Deploy and preview.** Run `clasp deploy`, open the link and click **Preview**. Expected: close to zero creates, updates and deletes, with your existing exclusions listed.
- [ ] **Step 6: Switch over.** Delete the old project's trigger, then click **Turn on sync** on the page. Confirm a scheduled run records a status.
- [ ] **Step 7: Turn on link sharing** as **Anyone with the link: Viewer**.
- [ ] **Step 8: Test as the second account, ideally with a calendar in another time zone.**
  1. Complete setup from the link, and confirm **Preview** writes nothing.
  2. **Turn on sync**, and confirm events appear and the trigger fires.
  3. Add a rule of each type, and confirm its events leave the mirror at the next sync.
  4. Confirm a rule with a time limit matches in that account's time zone.
  5. **Pause**, and confirm no further runs.
  6. Confirm neither account sees the other's rules or settings.
- [ ] **Step 9: Check privacy.** As the owner, open the second account's runs, and confirm the logs contain no event titles, calendar names or IDs. As the second account, confirm the project's Executions page doesn't show other users' runs.
- [ ] **Step 10: Decide on the old project.** Keep it private until you're happy, then delete it.
