// runTests() covers the pure functions. It touches no Calendar API or stored
// properties, so it's safe and fast to run, either in the Apps Script editor or
// with: TZ=America/New_York node dev/run-tests.js
//
// Rules are a BLACKLIST: matchesRules() returning true means the title/time
// matched an exclusion rule and should be filtered OUT of the mirror.
// `expected: true` below means "this event is excluded"; `expected: false`
// means "this event is mirrored" (the default for anything not matched).

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
    .concat(testIsBlockExpired())
    .concat(testDescribeOccurrenceRule())
    .concat(testLocalStartParts())
    .concat(testContainsRule())
    .concat(testValidateRule())
    .concat(testNormalizeAndCompileRule())
    .concat(testParseStoredRule())
    .concat(testDescribeRule())
    .concat(testFormatTime12())
    .concat(testAssertSafeMirror())
    .concat(testAssertReadyToSync())
    .concat(testIsRunStale())
    .concat(testSettingsValidators())
    .concat(testRunErrorDescriptions())
    .concat(testSummarizePlan())
    .concat(testIsMirrorMissing())
    .concat(testIdentityIsPinned())
    .concat(testMirrorDuplicates())
    .concat(testMassDeleteGuard())
    .concat(testStoredRuleFixtures())
    .concat(testDescribeRemovedRules())
    .concat(testComparePageEvents())
    .concat(testProgressReporter())
    .concat(testIsValidProgressToken());
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
      var actual = matchesRules(testCase.title, partsFromDate(testCase.startTime));
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
        matchesRules('Holiday Party', partsFromDate(new Date(2026, 11, 25, 12, 0)));
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
// These cover only the pure half of blocks.js and webapp.js. The User Properties
// store is deliberately not touched here, so running the tests can never alter
// real rules.

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

// Local start parts from a Date's getters, so fixtures can stay plain Dates.
// Real events go through localStartParts(), which is tested separately.
function partsFromDate(date) {
  var pad = function (value) {
    return (value < 10 ? '0' : '') + value;
  };
  return {
    date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()),
    day: DAY_CODES[date.getDay()],
    minutes: date.getHours() * 60 + date.getMinutes(),
    allDay: false,
  };
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
function storedRuleMatches(rule, title, parts) {
  return withRules([JSON.parse(JSON.stringify(rule))], function () {
    return matchesRules(title, parts);
  });
}

function testBuildBlockRule() {
  var lecture = partsFromDate(new Date(2026, 10, 4, 10, 0)); // Wed Nov 4 2026, 10:00am
  var nextWeek = partsFromDate(new Date(2026, 10, 11, 10, 0));
  var sameDayLater = partsFromDate(new Date(2026, 10, 4, 14, 0));
  var oneMinuteLater = partsFromDate(new Date(2026, 10, 4, 10, 1));
  var occurrence = buildBlockRule('occurrence', 'Lecture', lecture);
  var wholeTitle = buildBlockRule('title', 'Lecture', lecture);
  var lateNight = partsFromDate(new Date(2026, 10, 4, 23, 59));
  var allDay = partsFromDate(parseEventStart({ date: '2026-12-25' }));

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
      storedRuleMatches(buildBlockRule('occurrence', 'Holiday', allDay), 'Holiday', partsFromDate(new Date(2026, 11, 26)))),
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
    blockResult('start: an all-day date stays on the same local day', 25, allDay.getDate()),
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

function testIsBlockExpired() {
  var today = '2026-11-04';
  var ending = function (end) {
    return { type: 'exact', value: 'Lecture', date: { start: end, end: end } };
  };
  return [
    // A multi-day event excluded by a rule dated on its first day is still running
    // after that date, and removing the rule would bring it back to the mirror.
    blockResult('expiry: a block ending yesterday is kept', false, isBlockExpired(ending('2026-11-03'), today)),
    blockResult('expiry: a block ending 30 days ago is kept', false, isBlockExpired(ending('2026-10-05'), today)),
    blockResult('expiry: a block ending 31 days ago has expired', true, isBlockExpired(ending('2026-10-04'), today)),
    blockResult('expiry: the 30 days can cross a year boundary', true,
      isBlockExpired(ending('2026-12-01'), '2027-01-01')),
    blockResult('expiry: a block ending today has not', false, isBlockExpired(ending('2026-11-04'), today)),
    blockResult('expiry: a block ending later has not', false, isBlockExpired(ending('2026-11-05'), today)),
    blockResult('expiry: a title block never expires', false,
      isBlockExpired({ type: 'exact', value: 'Lecture' }, today)),
  ];
}

function testDescribeOccurrenceRule() {
  var start = partsFromDate(new Date(2026, 10, 4, 10, 0));
  return [
    blockResult('describe: title block', 'All events titled "Lecture"',
      describeRule(buildBlockRule('title', 'Lecture', start))),
    blockResult('describe: occurrence block', '"Lecture" on 2026-11-04 at 10:00 AM',
      describeRule(buildBlockRule('occurrence', 'Lecture', start))),
    blockResult('describe: untitled occurrence block', '(untitled) on 2026-11-04 at 10:00 AM',
      describeRule(buildBlockRule('occurrence', '', start))),
  ];
}

// --- Local start parts -------------------------------------------------------

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
    blockResult('parts: describes a timed start', '2026-11-04 10:30 AM', describeStart(ny)),
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

// --- Rule validation and storage ---------------------------------------------

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
    // Ticking "case-insensitive" must not get around the refusal above.
    ['any title with no limits and the i flag', { type: 'regex', value: '.*', flags: 'i' }],
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
    blockResult('describe: limits', 'All events titled "Standup", on MO, WE, starting between 9:00 AM and 10:00 AM', describeRule(withLimits)),
    blockResult('describe: any title with a range', 'All events, 2026-12-21 to 2027-01-01', describeRule(range)),
  ];
}

// Midnight is 12:00 AM at both ends of the day, since 24:00 is only ever an end.
function testFormatTime12() {
  var cases = [
    [0, '12:00 AM'], [5, '12:05 AM'], [9 * 60, '9:00 AM'], [12 * 60, '12:00 PM'],
    [13 * 60 + 30, '1:30 PM'], [23 * 60 + 59, '11:59 PM'], [24 * 60, '12:00 AM'],
  ];
  return cases.map(function (c) {
    return blockResult('time: ' + c[0] + ' minutes is ' + c[1], c[1], formatTime12(c[0]));
  });
}

// --- Settings and sync lifecycle ----------------------------------------------

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
    blockResult('mirror name: is trimmed', 'Marcus mirror', validateMirrorName('  Marcus mirror ')),
    throwsResult('mirror name: refuses empty', function () { validateMirrorName(''); }),
    throwsResult('mirror name: refuses whitespace', function () { validateMirrorName('   '); }),
    throwsResult('mirror name: refuses a non-string', function () { validateMirrorName(5); }),
    throwsResult('mirror name: refuses over 100 characters', function () { validateMirrorName(new Array(102).join('x')); }),
    blockResult('mirror name: accepts 100 characters', 100, validateMirrorName(new Array(101).join('x')).length),
    blockResult('mirror name: an error does not repeat the name', false, (function () {
      var name = new Array(102).join('secret');
      try { validateMirrorName(name); } catch (e) { return e.message.indexOf('secret') !== -1; }
      return 'no error';
    })()),
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
    blockResult('summary: a delete shows its local start when it has one', '2026-11-06 10:00', summarizePlan({
      creates: [],
      updates: [],
      deletes: [{ title: 'Old', start: '2026-11-06T15:00:00Z', startLabel: '2026-11-06 10:00', sourceName: 'A', syncKey: 'k' }],
      unchanged: 0,
    }, []).deletes[0].start),
    // A run that stops during creates has also deferred every update and delete.
    blockResult('summary: deferred counts every step the run did not reach', 3, finishRun({
      creates: ['a', 'b'],
      updates: ['c'],
      deletes: ['d'],
      unchanged: 0,
    }, { created: 1, updated: 0, deleted: 0, unchanged: 0, deferred: 0 }, true).deferred),
  ];
}

function testIsMirrorMissing() {
  var calendars = [{ id: 'm@x' }, { id: 'a@x' }];
  return [
    blockResult('mirror: no mirror set is not missing', false, isMirrorMissing('', calendars)),
    blockResult('mirror: a listed mirror is not missing', false, isMirrorMissing('m@x', calendars)),
    blockResult('mirror: a deleted mirror is missing', true, isMirrorMissing('gone@x', calendars)),
    blockResult('mirror name: found by id', 'Mine', findMirrorName('m@x', [{ id: 'a@x', name: 'A' }, { id: 'm@x', name: 'Mine' }])),
    blockResult('mirror name: empty with no mirror set', '', findMirrorName('', [{ id: '', name: 'A' }])),
    blockResult('mirror name: empty for a deleted mirror', '', findMirrorName('gone@x', calendars)),
  ];
}

// --- Safeguards ---------------------------------------------------------------

// These values came from the code that built the existing mirrors. If one changes,
// every mirrored event gets deleted and recreated, or rewritten, at the next sync.
function testIdentityIsPinned() {
  var results = [
    blockResult('pinned: a timed sync key', 'a578e362020ab2a407d490c5799c2705',
      computeSyncKey(SAMPLE_CALENDAR_ID, SAMPLE_ICAL_UID, new Date(Date.UTC(2026, 8, 1, 14, 0, 0)))),
    blockResult('pinned: a signature', '5edc93f0e15a375cea97da7c3a1cfac9',
      computeSignature(cloneResource(), SAMPLE_LAST_UPDATED)),
  ];
  // An all-day key depends on the script's time zone, New York in appsscript.json.
  // The local runner can use another zone, where this value wouldn't apply.
  if (new Date(2026, 11, 25).getTimezoneOffset() === 300) {
    results.push(blockResult('pinned: an all-day sync key', '7da188f90ac6f0ded0a9df0b21be79fe',
      computeSyncKey(SAMPLE_CALENDAR_ID, SAMPLE_ICAL_UID, parseEventStart({ date: '2026-12-25' }))));
  }
  return results;
}

function testMirrorDuplicates() {
  var item = function (id, syncKey) {
    var privateProps = {};
    privateProps[SYNC_KEY] = syncKey;
    privateProps[SIGNATURE_KEY] = 'same';
    return {
      id: id,
      summary: 'Holiday',
      start: { date: '2026-12-25' },
      extendedProperties: { private: privateProps },
    };
  };
  var index = emptyMirrorIndex();
  addMirrorItem(index, item('first', 'k1'));
  addMirrorItem(index, item('second', 'k1'));
  addMirrorItem(index, item('other', 'k2'));
  addMirrorItem(index, { id: 'manual', summary: 'By hand', start: { date: '2026-12-26' } });
  var desired = {
    k1: { syncKey: 'k1', signature: 'same' },
    k2: { syncKey: 'k2', signature: 'same' },
  };
  var plan = buildPlan(desired, index);
  var deletedIds = plan.deletes.map(function (entry) { return entry.id; }).sort().join(',');
  return [
    blockResult('duplicates: the first copy is kept', 'first', index.tracked.k1.id),
    blockResult('duplicates: only the extra copy and the untracked event are deleted', 'manual,second', deletedIds),
    blockResult('duplicates: the kept copies count as unchanged', 2, plan.unchanged),
    blockResult('duplicates: nothing is recreated', 0, plan.creates.length),
    blockResult('duplicates: the page explains why', 'A duplicate copy of another event in the mirror',
      summarizePlan(plan, []).deletes.filter(function (row) { return row.reason.indexOf('duplicate') !== -1; })[0].reason),
  ];
}

function testMassDeleteGuard() {
  var plan = function (deletes, keptInMirror) {
    var list = [];
    for (var i = 0; i < deletes; i++) {
      list.push({ title: 'PRIVATE-TITLE', start: '2026-11-04', sourceName: 'PRIVATE-CALENDAR', syncKey: 'k' + i });
    }
    return { creates: [], updates: [], deletes: list, unchanged: keptInMirror };
  };
  return [
    blockResult('mass delete: an empty mirror is not', false, isMassDelete(plan(0, 0))),
    blockResult('mass delete: 9 of 9 is below the minimum', false, isMassDelete(plan(9, 0))),
    blockResult('mass delete: exactly half is not', false, isMassDelete(plan(10, 10))),
    blockResult('mass delete: just over half is', true, isMassDelete(plan(10, 9))),
    blockResult('mass delete: all of a large mirror is', true, isMassDelete(plan(20, 0))),
    blockResult('mass delete: events still to be created do not count as being in the mirror', true, isMassDelete({
      creates: plan(50, 0).deletes, updates: [], deletes: plan(10, 0).deletes, unchanged: 0,
    })),
    blockResult('mass delete: events to update count as being in the mirror', false, isMassDelete({
      creates: [], updates: plan(10, 0).deletes, deletes: plan(10, 0).deletes, unchanged: 0,
    })),
    blockResult('mass delete: a scheduled run stops', true, shouldStopForDeletes(plan(20, 0), 0)),
    blockResult('mass delete: an approved preview allows it', false, shouldStopForDeletes(plan(20, 0), 20)),
    // Something changed after the preview, so its approval doesn't cover this.
    blockResult('mass delete: a larger delete than was previewed stops', true, shouldStopForDeletes(plan(21, 0), 20)),
    blockResult('mass delete: an ordinary delete never stops', false, shouldStopForDeletes(plan(5, 100), 0)),
    blockResult('mass delete: the preview flags it', true, summarizePlan(plan(20, 0), []).massDelete),
    blockResult('mass delete: the preview does not flag an ordinary delete', false, summarizePlan(plan(5, 100), []).massDelete),
    // This message reaches the owner's logs when rethrown.
    blockResult('mass delete: the message gives counts only',
      'vCal stopped before deleting 20 of the 25 events in your mirror. Click Preview to check the list, then Sync now to go ahead.',
      describeMassDelete(plan(20, 5))),
  ];
}

// Rules already saved by real users. A rule that stops validating is deleted the
// next time it loads, so tightening validateRule() can wipe rules for every user at
// once. Only ever add to this list. If one of these fails, loosen the change.
var STORED_RULE_FIXTURES = [
  '{"type":"exact","value":"Lecture"}',
  '{"type":"exact","value":"  Spaces kept  "}',
  '{"type":"contains","value":"exam"}',
  '{"type":"regex","value":"^Lab\\\\b"}',
  '{"type":"regex","value":"^lab","flags":"i"}',
  '{"type":"regex","value":".*","date":{"start":"2026-12-25","end":"2026-12-25"}}',
  '{"type":"regex","value":".*","days":["SA","SU"]}',
  '{"type":"exact","value":"Standup","days":["MO","WE"],"time":{"start":"09:00","end":"10:00"}}',
  '{"type":"exact","value":"Break","date":{"start":"2026-12-20","end":"2027-01-05"}}',
  '{"type":"exact","value":"Late","date":{"start":"2026-11-04","end":"2026-11-04"},"time":{"start":"23:59","end":"24:00"}}',
  '{"type":"exact","value":"","date":{"start":"2026-11-04","end":"2026-11-04"},"time":{"start":"10:00","end":"10:01"}}',
];

function testStoredRuleFixtures() {
  return STORED_RULE_FIXTURES.map(function (json) {
    return blockResult('stored fixture stays readable: ' + json, true, parseStoredRule(json) !== null);
  });
}

function testDescribeRemovedRules() {
  return [
    blockResult('removed rules: one',
      '1 saved rule could not be read and was removed, so events it excluded may return to your mirror.',
      describeRemovedRules(1)),
    blockResult('removed rules: several',
      '3 saved rules could not be read and were removed, so events they excluded may return to your mirror.',
      describeRemovedRules(3)),
  ];
}

// Sorts by what the page shows, because an all-day event's instant follows the
// script's time zone and a heading is printed each time the day changes.
function testComparePageEvents() {
  var events = [
    { title: 'evening', day: '2026-11-06', minutes: 18 * 60 },
    { title: 'next day all-day', day: '2026-11-07', minutes: -1 },
    { title: 'all-day', day: '2026-11-06', minutes: -1 },
    { title: 'late the day before', day: '2026-11-05', minutes: 23 * 60 },
    { title: 'late morning', day: '2026-11-06', minutes: 10 * 60 },
    { title: 'morning', day: '2026-11-06', minutes: 9 * 60 },
  ];
  var sorted = events.slice().sort(comparePageEvents).map(function (event) { return event.title; }).join(', ');
  return [
    blockResult('page events: by day, then all-day first, then time',
      'late the day before, all-day, morning, late morning, evening, next day all-day', sorted),
  ];
}

// Only the write phase is throttled, and never its first or last count, so the
// page doesn't sit on a stale calendar or stop short of 100%.
function testProgressReporter() {
  var written = [];
  var clock = 0;
  var report = makeProgressReporter(function (json) { written.push(json); }, function () { return clock; });
  report('read', 1, 2);
  clock = 100;
  report('read', 2, 2);
  report('mirror', 0, 0);
  report('write', 0, 10);
  clock = 500;
  report('write', 1, 10);
  clock = 1100;
  report('write', 2, 10);
  clock = 1200;
  report('write', 3, 10);
  report('write', 10, 10);
  var phases = written.map(function (json) {
    var parsed = JSON.parse(json);
    return parsed.phase + ' ' + parsed.done + '/' + parsed.total;
  }).join(', ');
  return [
    blockResult('progress: reads always, writes at most once a second, and the last write',
      'read 1/2, read 2/2, mirror 0/0, write 0/10, write 2/10, write 10/10', phases),
    blockResult('progress: holds only the phase and counts',
      'done,phase,total', Object.keys(JSON.parse(written[0])).sort().join(',')),
  ];
}

function testIsValidProgressToken() {
  var token = Date.now().toString(36) + Math.random().toString(36).slice(2);
  return [
    blockResult('progress token: a page token', true, isValidProgressToken(token)),
    blockResult('progress token: missing', false, isValidProgressToken(undefined)),
    blockResult('progress token: empty', false, isValidProgressToken('')),
    blockResult('progress token: too long', false, isValidProgressToken(new Array(42).join('a'))),
    blockResult('progress token: punctuation', false, isValidProgressToken('progress:abc')),
    blockResult('progress token: not a string', false, isValidProgressToken(123)),
  ];
}
