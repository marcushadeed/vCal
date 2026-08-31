// Test harness for matchesRules(). Runs without touching CalendarApp, so
// it's safe and fast to run from the Apps Script editor before enabling
// the schedule trigger.
//
// Rules are a BLACKLIST: matchesRules() returning true means the title/time
// matched an exclusion rule and should be filtered OUT of the mirror.
// `expected: true` below means "this event is excluded"; `expected: false`
// means "this event is mirrored" (the default for anything not matched).
//
// PLACEHOLDER FIXTURES: TEST_RULES and TEST_CASES below use made-up titles
// and times. Replace them with real titles (and real recurrence times)
// from your source calendars before trusting these results.

var TEST_RULES = [
  { type: 'exact', value: 'All-Hands Meeting' },
  { type: 'exact', value: 'Team Standup', days: ['MO'], time: { start: '09:00', end: '10:00' } },
  { type: 'regex', value: /^Sprint Planning/i },
];

var TEST_CASES = [
  {
    description: 'exact match, no day/time constraint -> excluded',
    title: 'All-Hands Meeting',
    startTime: new Date(2026, 0, 6, 15, 0), // Tue Jan 6 2026, 3:00pm
    expected: true,
  },
  {
    description: 'regex match -> excluded',
    title: 'Sprint Planning - Q3 Kickoff',
    startTime: new Date(2026, 0, 6, 11, 0), // Tue Jan 6 2026, 11:00am
    expected: true,
  },
  {
    description: 'no rule matches -> mirrored by default',
    title: 'Random 1:1 with Manager',
    startTime: new Date(2026, 0, 7, 10, 0), // Wed Jan 7 2026, 10:00am
    expected: false,
  },
  {
    description: 'day+time constrained rule: matching instance (Mon 9:30am) -> excluded',
    title: 'Team Standup',
    startTime: new Date(2026, 0, 5, 9, 30), // Mon Jan 5 2026, 9:30am
    expected: true,
  },
  {
    description: 'day+time constrained rule: sibling instance on wrong day (Wed 9:30am) -> mirrored',
    title: 'Team Standup',
    startTime: new Date(2026, 0, 7, 9, 30), // Wed Jan 7 2026, 9:30am
    expected: false,
  },
  {
    description: 'day+time constrained rule: sibling instance on right day, wrong time (Mon 2:00pm) -> mirrored',
    title: 'Team Standup',
    startTime: new Date(2026, 0, 5, 14, 0), // Mon Jan 5 2026, 2:00pm
    expected: false,
  },
];

function runTests() {
  var results = testMatchesRules()
    .concat(testComputeSyncKey())
    .concat(testComputeSignature());
  var failures = results.filter(function (r) { return !r.passed; });

  results.forEach(function (r) {
    Logger.log(
      (r.passed ? 'PASS' : 'FAIL') + ' - ' + r.description +
      ' (expected ' + r.expected + ', got ' + r.actual + ')'
    );
  });

  Logger.log(results.length + ' test case(s), ' + failures.length + ' failed.');

  if (failures.length > 0) {
    throw new Error(failures.length + ' test case(s) failed. See log above.');
  }
  Logger.log('All tests passed.');
}

function testMatchesRules() {
  if (typeof CONFIG === 'undefined') {
    throw new Error('CONFIG is not defined. Copy config.example.js to config.js before running tests.');
  }

  // Swap in fixture rules for the duration of the test run, then restore
  // whatever the user's real config had — this keeps matchesRules()'s
  // two-argument signature while testing against known fixtures rather
  // than the user's live rules.
  var originalRules = CONFIG.rules;
  var results = [];
  try {
    CONFIG.rules = TEST_RULES;
    TEST_CASES.forEach(function (testCase) {
      var actual = matchesRules(testCase.title, testCase.startTime);
      results.push({
        description: testCase.description,
        expected: testCase.expected,
        actual: actual,
        passed: actual === testCase.expected,
      });
    });
  } finally {
    CONFIG.rules = originalRules;
  }
  return results;
}

// --- Identity and change detection ---------------------------------------
//
// computeSyncKey() and computeSignature() are pure, so they are testable
// here without touching CalendarApp. These are the two functions incremental
// reconciliation depends on: the key decides which mirrored event
// corresponds to which source instance, and the signature decides whether
// that event needs rewriting.

var SAMPLE_CALENDAR_ID = 'source-a@group.calendar.google.com';
var SAMPLE_ICAL_UID = 'abc123@google.com';

var SAMPLE_RESOURCE = {
  summary: 'Chemistry Lecture',
  location: 'Chem 1407',
  description: 'Bring the lab notebook',
  start: { dateTime: '2026-09-01T14:00:00.000Z' },
  end: { dateTime: '2026-09-01T15:00:00.000Z' },
  colorId: '5',
  visibility: 'private',
};

var SAMPLE_LAST_UPDATED = new Date(Date.UTC(2026, 7, 20, 12, 0, 0));

function cloneResource(overrides) {
  var copy = JSON.parse(JSON.stringify(SAMPLE_RESOURCE));
  Object.keys(overrides || {}).forEach(function (key) {
    copy[key] = overrides[key];
  });
  return copy;
}

function testComputeSyncKey() {
  var baseline = computeSyncKey(SAMPLE_CALENDAR_ID, SAMPLE_ICAL_UID, new Date(Date.UTC(2026, 8, 1, 14, 0, 0)));
  var cases = [
    {
      description: 'sync key: same inputs produce the same key',
      actual: computeSyncKey(SAMPLE_CALENDAR_ID, SAMPLE_ICAL_UID, new Date(Date.UTC(2026, 8, 1, 14, 0, 0))),
      shouldEqualBaseline: true,
    },
    {
      // The critical one. Every occurrence of a recurring series shares a
      // single iCalUID, so without the start time in the key all ~75
      // meetings of a course would collapse onto one mirrored event.
      description: 'sync key: same iCalUID at a different start time is a different key',
      actual: computeSyncKey(SAMPLE_CALENDAR_ID, SAMPLE_ICAL_UID, new Date(Date.UTC(2026, 8, 8, 14, 0, 0))),
      shouldEqualBaseline: false,
    },
    {
      description: 'sync key: same event id on a different source calendar is a different key',
      actual: computeSyncKey('source-b@group.calendar.google.com', SAMPLE_ICAL_UID, new Date(Date.UTC(2026, 8, 1, 14, 0, 0))),
      shouldEqualBaseline: false,
    },
  ];

  return cases.map(function (testCase) {
    var matched = testCase.actual === baseline;
    return {
      description: testCase.description,
      expected: testCase.shouldEqualBaseline ? 'same key' : 'different key',
      actual: matched ? 'same key' : 'different key',
      passed: matched === testCase.shouldEqualBaseline,
    };
  });
}

function testComputeSignature() {
  var baseline = computeSignature(cloneResource(), SAMPLE_LAST_UPDATED);

  var cases = [
    {
      description: 'signature: identical input produces an identical signature',
      resource: cloneResource(),
      lastUpdated: SAMPLE_LAST_UPDATED,
      shouldEqualBaseline: true,
    },
    { description: 'signature: title change is detected', resource: cloneResource({ summary: 'Chemistry Lab' }) },
    { description: 'signature: location change is detected', resource: cloneResource({ location: 'Chem 1402' }) },
    { description: 'signature: description change is detected', resource: cloneResource({ description: 'Cancelled' }) },
    { description: 'signature: start time change is detected', resource: cloneResource({ start: { dateTime: '2026-09-01T16:00:00.000Z' } }) },
    { description: 'signature: end time change is detected', resource: cloneResource({ end: { dateTime: '2026-09-01T17:00:00.000Z' } }) },
    { description: 'signature: colour change is detected', resource: cloneResource({ colorId: '7' }) },
    { description: 'signature: visibility change is detected', resource: cloneResource({ visibility: 'public' }) },
    {
      description: 'signature: switching to an all-day event is detected',
      resource: cloneResource({ start: { date: '2026-09-01' }, end: { date: '2026-09-02' } }),
    },
    {
      // The catch-all layer: a source edit to a property this script never
      // reads still has to force the mirrored copy to be rewritten.
      description: 'signature: a source edit to an unmirrored property is still detected via lastUpdated',
      resource: cloneResource(),
      lastUpdated: new Date(Date.UTC(2026, 7, 21, 9, 30, 0)),
    },
  ];

  return cases.map(function (testCase) {
    var lastUpdated = testCase.lastUpdated || SAMPLE_LAST_UPDATED;
    var actual = computeSignature(testCase.resource, lastUpdated);
    var matched = actual === baseline;
    var shouldMatch = testCase.shouldEqualBaseline === true;
    return {
      description: testCase.description,
      expected: shouldMatch ? 'same signature' : 'different signature',
      actual: matched ? 'same signature' : 'different signature',
      passed: matched === shouldMatch,
    };
  });
}
