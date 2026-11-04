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
  { type: 'exact', value: 'Holiday Party', date: { start: '2026-12-24', end: '2026-12-26' } },
  { type: 'exact', value: 'Fall Break', date: { start: '2026-09-25', end: '2026-10-05' } },
  { type: 'exact', value: 'Winter Break', date: { start: '2026-12-20', end: '2027-01-05' } },
  { type: 'exact', value: 'Team Sync', days: ['MO'], date: { start: '2026-08-01', end: '2026-08-31' } },
  { type: 'regex', value: /.*/, date: { start: '2026-07-04', end: '2026-07-04' } },
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
  {
    description: 'date rule: last minute before the range -> mirrored',
    title: 'Holiday Party',
    startTime: new Date(2026, 11, 23, 23, 59),
    expected: false,
  },
  {
    description: 'date rule: first minute of the range -> excluded',
    title: 'Holiday Party',
    startTime: new Date(2026, 11, 24, 0, 0),
    expected: true,
  },
  {
    description: 'date rule: end date is inclusive, last minute of it -> excluded',
    title: 'Holiday Party',
    startTime: new Date(2026, 11, 26, 23, 59),
    expected: true,
  },
  {
    description: 'date rule: first minute after the range -> mirrored',
    title: 'Holiday Party',
    startTime: new Date(2026, 11, 27, 0, 0),
    expected: false,
  },
  {
    description: 'date rule: range spanning a month boundary, single-digit day -> excluded',
    title: 'Fall Break',
    startTime: new Date(2026, 9, 1, 12, 0),
    expected: true,
  },
  {
    description: 'date rule: range spanning a year boundary -> excluded',
    title: 'Winter Break',
    startTime: new Date(2027, 0, 2, 12, 0),
    expected: true,
  },
  {
    description: 'date rule: same month and day in a different year -> mirrored',
    title: 'Holiday Party',
    startTime: new Date(2027, 11, 25, 12, 0),
    expected: false,
  },
  {
    description: 'date+day rule: in range on the right day (Mon Aug 3) -> excluded',
    title: 'Team Sync',
    startTime: new Date(2026, 7, 3, 10, 0),
    expected: true,
  },
  {
    description: 'date+day rule: in range on the wrong day (Tue Aug 4) -> mirrored',
    title: 'Team Sync',
    startTime: new Date(2026, 7, 4, 10, 0),
    expected: false,
  },
  {
    description: 'date rule with match-any title: any event on that date -> excluded',
    title: 'Anything At All',
    startTime: new Date(2026, 6, 4, 15, 0),
    expected: true,
  },
  {
    description: 'date rule with match-any title: the day after -> mirrored',
    title: 'Anything At All',
    startTime: new Date(2026, 6, 5, 15, 0),
    expected: false,
  },
];

function runTests() {
  var results = testMatchesRules()
    .concat(testMalformedDateRules())
    .concat(testComputeSyncKey())
    .concat(testComputeSignature())
    .concat(testResolveColorId())
    .concat(testBuildEventResource())
    .concat(testBuildBlockRule())
    .concat(testParseEventStart())
    .concat(testClassifyEvent())
    .concat(testIsBlockExpired())
    .concat(testDescribeBlock());
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

// A malformed date would otherwise compare as plain text and silently exclude
// the wrong events, so it has to fail the run instead.
function testMalformedDateRules() {
  var cases = [
    { description: 'date rule: US-style date is rejected', date: { start: '12/25/2026', end: '12/25/2026' } },
    { description: 'date rule: unpadded date is rejected', date: { start: '2026-1-5', end: '2026-1-5' } },
    { description: 'date rule: missing end is rejected', date: { start: '2026-12-25' } },
  ];

  var originalRules = CONFIG.rules;
  try {
    return cases.map(function (testCase) {
      CONFIG.rules = [{ type: 'exact', value: 'Holiday Party', date: testCase.date }];
      var threw = false;
      try {
        matchesRules('Holiday Party', new Date(2026, 11, 25, 12, 0));
      } catch (e) {
        threw = true;
      }
      return {
        description: testCase.description,
        expected: 'throws',
        actual: threw ? 'throws' : 'no error',
        passed: threw,
      };
    });
  } finally {
    CONFIG.rules = originalRules;
  }
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

// resolveColorId() decides the colour on its own; testBuildEventResource()
// covers it being applied to the finished resource. '' means "leave colorId
// unset", i.e. the mirror calendar's default.
function testResolveColorId() {
  var cases = [
    {
      description: 'colour: the source event\'s own colour wins over the calendar colour',
      eventColor: '7',
      sourceColor: '9',
      expected: '7',
    },
    {
      description: 'colour: an event on the calendar default takes the source calendar\'s colour',
      eventColor: '',
      sourceColor: '9',
      expected: '9',
    },
    {
      description: 'colour: an event colour with no configured calendar colour is kept',
      eventColor: '7',
      sourceColor: undefined,
      expected: '7',
    },
    {
      description: 'colour: neither set leaves the colour unset',
      eventColor: '',
      sourceColor: undefined,
      expected: '',
    },
    {
      description: 'colour: an out-of-range calendar colour is ignored, event colour still applies',
      eventColor: '7',
      sourceColor: '12',
      expected: '7',
    },
    {
      description: 'colour: an out-of-range calendar colour with no event colour leaves it unset',
      eventColor: '',
      sourceColor: '0',
      expected: '',
    },
    {
      description: 'colour: a non-numeric calendar colour is ignored',
      eventColor: '',
      sourceColor: 'blue',
      expected: '',
    },
    {
      // `color: 5` in config is an easy slip and means the same as '5'.
      description: 'colour: a numeric calendar colour is normalised to a string',
      eventColor: '',
      sourceColor: 10,
      expected: '10',
    },
  ];

  return cases.map(function (testCase) {
    var actual = resolveColorId(testCase.eventColor, testCase.sourceColor);
    return {
      description: testCase.description,
      expected: testCase.expected === '' ? '(unset)' : testCase.expected,
      actual: actual === '' ? '(unset)' : actual,
      passed: actual === testCase.expected,
    };
  });
}

// --- Building the mirrored copy ----------------------------------------------
//
// The input is a Calendar API event item. The signature case matters most: the
// API returns times with an offset, and if those reached computeSignature()
// unnormalised, every mirrored event would look changed.

var SAMPLE_TIMED_ITEM = {
  iCalUID: SAMPLE_ICAL_UID,
  summary: 'Chemistry Lecture',
  location: 'Chem 1407',
  description: 'Bring the lab notebook',
  start: { dateTime: '2026-09-01T10:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-09-01T11:00:00-04:00', timeZone: 'America/New_York' },
  colorId: '5',
  visibility: 'private',
  attendees: [{ email: 'someone@example.com' }],
  reminders: { useDefault: true },
};

var SAMPLE_ALL_DAY_ITEM = {
  iCalUID: SAMPLE_ICAL_UID,
  summary: 'Fall Break',
  start: { date: '2026-10-01' },
  end: { date: '2026-10-03' },
};

var SAMPLE_BARE_ITEM = {
  iCalUID: SAMPLE_ICAL_UID,
  start: { dateTime: '2026-09-01T14:00:00Z' },
  end: { dateTime: '2026-09-01T15:00:00Z' },
  visibility: 'default',
};

function testBuildEventResource() {
  var timed = buildEventResource(SAMPLE_TIMED_ITEM, '9');
  var allDay = buildEventResource(SAMPLE_ALL_DAY_ITEM, undefined);
  var bare = buildEventResource(SAMPLE_BARE_ITEM, undefined);
  var bareWithCalendarColor = buildEventResource(SAMPLE_BARE_ITEM, '9');

  return [
    blockResult('resource: a timed start becomes a UTC timestamp', '2026-09-01T14:00:00.000Z', timed.start.dateTime),
    blockResult('resource: a timed end becomes a UTC timestamp', '2026-09-01T15:00:00.000Z', timed.end.dateTime),
    blockResult('resource: an offset start hashes the same as its UTC form',
      computeSignature(cloneResource(), SAMPLE_LAST_UPDATED),
      computeSignature(timed, SAMPLE_LAST_UPDATED)),
    blockResult('resource: an all-day start keeps its date', '2026-10-01', allDay.start.date),
    blockResult('resource: an all-day end keeps its exclusive date', '2026-10-03', allDay.end.date),
    blockResult('resource: an all-day start has no dateTime', false, 'dateTime' in allDay.start),
    blockResult('resource: a missing title becomes empty', '', bare.summary),
    blockResult('resource: a missing location becomes empty', '', bare.location),
    blockResult('resource: a missing description becomes empty', '', bare.description),
    blockResult('resource: attendees are never copied', false, 'attendees' in timed),
    blockResult('resource: reminders are always cleared', '{"useDefault":false,"overrides":[]}',
      JSON.stringify(timed.reminders)),
    blockResult('resource: the event colour wins over the calendar colour', '5', timed.colorId),
    blockResult('resource: an event with no colour takes the calendar colour', '9', bareWithCalendarColor.colorId),
    blockResult('resource: no colour at all leaves colorId unset', false, 'colorId' in bare),
    blockResult('resource: private visibility is kept', 'private', timed.visibility),
    blockResult('resource: default visibility is left unset', false, 'visibility' in bare),
  ];
}

// --- Page-made blocks --------------------------------------------------------
//
// These cover only the pure half of blocks.js and webapp.js. The Script
// Properties store is deliberately not touched here, so running the tests can
// never alter real blocks.

function blockResult(description, expected, actual) {
  return { description: description, expected: expected, actual: actual, passed: actual === expected };
}

function throwsResult(description, fn) {
  var threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  return blockResult(description, 'throws', threw ? 'throws' : 'no error');
}

function withRules(rules, fn) {
  var originalRules = CONFIG.rules;
  try {
    CONFIG.rules = rules;
    return fn();
  } finally {
    CONFIG.rules = originalRules;
  }
}

// Round-trips the rule through JSON first, because that is what the store does
// to it. A rule that only matched before serialising would pass otherwise.
function storedRuleMatches(rule, title, startTime) {
  return withRules([JSON.parse(JSON.stringify(rule))], function () {
    return matchesRules(title, startTime);
  });
}

function testBuildBlockRule() {
  var lecture = new Date(2026, 10, 4, 10, 0); // Wed Nov 4 2026, 10:00am
  var nextWeek = new Date(2026, 10, 11, 10, 0);
  var sameDayLater = new Date(2026, 10, 4, 14, 0);
  var oneMinuteLater = new Date(2026, 10, 4, 10, 1);
  var occurrence = buildBlockRule('occurrence', 'Lecture', lecture);
  var wholeTitle = buildBlockRule('title', 'Lecture', lecture);
  var lateNight = new Date(2026, 10, 4, 23, 59);
  var allDay = parseEventStart({ date: '2026-12-25' });

  return [
    blockResult('block: occurrence rule matches that occurrence', true,
      storedRuleMatches(occurrence, 'Lecture', lecture)),
    blockResult('block: occurrence rule does not match the same time on another day', false,
      storedRuleMatches(occurrence, 'Lecture', nextWeek)),
    blockResult('block: occurrence rule does not match another time that day', false,
      storedRuleMatches(occurrence, 'Lecture', sameDayLater)),
    blockResult('block: occurrence rule window ends after one minute', false,
      storedRuleMatches(occurrence, 'Lecture', oneMinuteLater)),
    blockResult('block: occurrence rule does not match another title', false,
      storedRuleMatches(occurrence, 'Seminar', lecture)),
    blockResult('block: title rule matches every instance', true,
      storedRuleMatches(wholeTitle, 'Lecture', nextWeek)),
    blockResult('block: title rule does not match another title', false,
      storedRuleMatches(wholeTitle, 'Seminar', lecture)),
    blockResult('block: 23:59 start is matched', true,
      storedRuleMatches(buildBlockRule('occurrence', 'Late', lateNight), 'Late', lateNight)),
    blockResult('block: all-day occurrence is matched', true,
      storedRuleMatches(buildBlockRule('occurrence', 'Holiday', allDay), 'Holiday', allDay)),
    blockResult('block: all-day occurrence does not match the next day', false,
      storedRuleMatches(buildBlockRule('occurrence', 'Holiday', allDay), 'Holiday', new Date(2026, 11, 26))),
    blockResult('block: untitled occurrence is allowed and matched', true,
      storedRuleMatches(buildBlockRule('occurrence', '', lecture), '', lecture)),
    throwsResult('block: title rule refuses an empty title', function () {
      buildBlockRule('title', '', lecture);
    }),
    throwsResult('block: title rule refuses a whitespace-only title', function () {
      buildBlockRule('title', '   ', lecture);
    }),
    throwsResult('block: an unknown scope is refused', function () {
      buildBlockRule('series', 'Lecture', lecture);
    }),
  ];
}

function testParseEventStart() {
  var allDay = parseEventStart({ date: '2026-12-25' });
  var timed = parseEventStart({ dateTime: '2026-09-01T14:00:00.000Z' });
  return [
    // new Date('2026-12-25') would be UTC midnight, i.e. Dec 24 in New York.
    blockResult('start: an all-day date stays on the same local day', '2026-12-25', formatDate(allDay)),
    blockResult('start: an all-day date is local midnight', 0, allDay.getHours()),
    blockResult('start: a timed start keeps its instant', Date.UTC(2026, 8, 1, 14, 0, 0), timed.getTime()),
    throwsResult('start: a malformed all-day date is refused', function () {
      parseEventStart({ date: '12/25/2026' });
    }),
    throwsResult('start: a malformed timed start is refused', function () {
      parseEventStart({ dateTime: 'not a date' });
    }),
  ];
}

function testClassifyEvent() {
  var start = new Date(2026, 10, 4, 10, 0);
  var configRule = { type: 'exact', value: 'From Config' };
  var pageRule = { type: 'exact', value: 'From Page' };
  var bothRule = { type: 'exact', value: 'Both' };
  return withRules([configRule, bothRule], function () {
    var pageRules = [pageRule, bothRule];
    return [
      blockResult('classify: a config rule match is reported as config', 'config',
        classifyEvent('From Config', start, pageRules)),
      blockResult('classify: a page block match is reported as page', 'page',
        classifyEvent('From Page', start, pageRules)),
      // Only config can be named here, as unblocking wouldn't bring it back.
      blockResult('classify: a match on both is reported as config', 'config',
        classifyEvent('Both', start, pageRules)),
      blockResult('classify: no match is reported as null', null,
        classifyEvent('Neither', start, pageRules)),
    ];
  });
}

function testIsBlockExpired() {
  var today = '2026-11-04';
  var ending = function (end) {
    return { type: 'exact', value: 'Lecture', date: { start: end, end: end } };
  };
  return [
    blockResult('expiry: a block ending yesterday has expired', true, isBlockExpired(ending('2026-11-03'), today)),
    blockResult('expiry: a block ending today has not', false, isBlockExpired(ending('2026-11-04'), today)),
    blockResult('expiry: a block ending later has not', false, isBlockExpired(ending('2026-11-05'), today)),
    blockResult('expiry: a title block never expires', false,
      isBlockExpired({ type: 'exact', value: 'Lecture' }, today)),
  ];
}

function testDescribeBlock() {
  var start = new Date(2026, 10, 4, 10, 0);
  return [
    blockResult('describe: title block', 'All events titled "Lecture"',
      describeBlock(buildBlockRule('title', 'Lecture', start))),
    blockResult('describe: occurrence block', '"Lecture" on 2026-11-04 at 10:00',
      describeBlock(buildBlockRule('occurrence', 'Lecture', start))),
    blockResult('describe: untitled occurrence block', '(untitled) on 2026-11-04 at 10:00',
      describeBlock(buildBlockRule('occurrence', '', start))),
  ];
}
