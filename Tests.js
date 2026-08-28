// Test harness for matchesRules(). Runs without touching CalendarApp, so
// it's safe and fast to run from the Apps Script editor before enabling
// the schedule trigger.
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
    description: 'exact match, no day/time constraint',
    title: 'All-Hands Meeting',
    startTime: new Date(2026, 0, 6, 15, 0), // Tue Jan 6 2026, 3:00pm
    expected: true,
  },
  {
    description: 'regex match',
    title: 'Sprint Planning - Q3 Kickoff',
    startTime: new Date(2026, 0, 6, 11, 0), // Tue Jan 6 2026, 11:00am
    expected: true,
  },
  {
    description: 'no rule matches',
    title: 'Random 1:1 with Manager',
    startTime: new Date(2026, 0, 7, 10, 0), // Wed Jan 7 2026, 10:00am
    expected: false,
  },
  {
    description: 'day+time constrained rule: matching instance (Mon 9:30am)',
    title: 'Team Standup',
    startTime: new Date(2026, 0, 5, 9, 30), // Mon Jan 5 2026, 9:30am
    expected: true,
  },
  {
    description: 'day+time constrained rule: sibling instance on wrong day (Wed 9:30am)',
    title: 'Team Standup',
    startTime: new Date(2026, 0, 7, 9, 30), // Wed Jan 7 2026, 9:30am
    expected: false,
  },
  {
    description: 'day+time constrained rule: sibling instance on right day, wrong time (Mon 2:00pm)',
    title: 'Team Standup',
    startTime: new Date(2026, 0, 5, 14, 0), // Mon Jan 5 2026, 2:00pm
    expected: false,
  },
];

function runTests() {
  var results = testMatchesRules();
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
