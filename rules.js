// Pure title/time filter logic. No Calendar calls here, so this file is testable
// by calling matchesRules() directly with plain values.
//
// CONFIG.rules is a BLACKLIST: an event is mirrored unless it matches one of
// these rules. matchesRules() returns true when the title (and, if the rule
// specifies them, day/time/date) matches a rule, meaning the event should be
// EXCLUDED from the mirror.
//
// Times are plain local parts from localStartParts(), not Dates, because a
// Date's getters always use the script's time zone and rules follow each user's.
//
// The only external state this depends on is CONFIG.rules.

var DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function matchesRules(title, parts) {
  return CONFIG.rules.some(function (rule) {
    return ruleMatches(rule, title, parts);
  });
}

// Returns the first rule in CONFIG.rules that matches, or null. Used to name
// the matching rule in a preview.
function findMatchingRule(title, parts) {
  var rules = CONFIG.rules;
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (ruleMatches(rule, title, parts)) {
      return rule;
    }
  }
  return null;
}

function ruleMatches(rule, title, parts) {
  return ruleMatchesTitle(rule, title) &&
    ruleMatchesDay(rule, parts) &&
    ruleMatchesTime(rule, parts) &&
    ruleMatchesDate(rule, parts);
}

function ruleMatchesTitle(rule, title) {
  if (rule.type === 'exact') {
    return title.trim() === rule.value.trim();
  }
  if (rule.type === 'contains') {
    return title.toLowerCase().indexOf(rule.value.trim().toLowerCase()) !== -1;
  }
  if (rule.type === 'regex') {
    return rule.value.test(title);
  }
  throw new Error('Unknown rule type.');
}

function ruleMatchesDay(rule, parts) {
  if (!rule.days) {
    return true;
  }
  return rule.days.indexOf(parts.day) !== -1;
}

function ruleMatchesTime(rule, parts) {
  if (!rule.time) {
    return true;
  }
  var minutes = parts.minutes;
  var start = parseTimeToMinutes(rule.time.start);
  var end = parseTimeToMinutes(rule.time.end);
  return minutes >= start && minutes < end;
}

function parseTimeToMinutes(hhmm) {
  var parts = hhmm.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// Both ends of the range are inclusive. Zero-padded YYYY-MM-DD strings sort
// chronologically, so plain string comparison is enough.
function ruleMatchesDate(rule, parts) {
  if (!rule.date) {
    return true;
  }
  assertValidDate(rule.date.start);
  assertValidDate(rule.date.end);
  return parts.date >= rule.date.start && parts.date <= rule.date.end;
}

// A malformed date would compare as plain text and silently exclude the wrong
// events, so fail the run instead.
function assertValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Invalid date. Expected YYYY-MM-DD.');
  }
}

// Turns an API start ({ date } or { dateTime }) into local parts in the given
// time zone: { date: 'YYYY-MM-DD', day: 'MO', minutes, allDay }.
//
// An all-day date is used as is, because it names a day rather than an instant.
// Its weekday comes from Date.UTC so no time-zone conversion can move it.
function localStartParts(start, timeZone) {
  if (start.date) {
    assertValidDate(start.date);
    return { date: start.date, day: dayCodeOf(start.date), minutes: 0, allDay: true };
  }
  var instant = new Date(start.dateTime);
  if (isNaN(instant.getTime())) {
    throw new Error('Invalid event start.');
  }
  var formatted = Utilities.formatDate(instant, timeZone, 'yyyy-MM-dd HH:mm');
  var date = formatted.substring(0, 10);
  return {
    date: date,
    day: dayCodeOf(date),
    minutes: parseTimeToMinutes(formatted.substring(11)),
    allDay: false,
  };
}

function dayCodeOf(date) {
  var pieces = date.split('-');
  var utc = Date.UTC(parseInt(pieces[0], 10), parseInt(pieces[1], 10) - 1, parseInt(pieces[2], 10));
  return DAY_CODES[new Date(utc).getUTCDay()];
}

// '2026-11-04 10:30', or '2026-11-04' when all-day.
function describeStart(parts) {
  return parts.allDay ? parts.date : parts.date + ' ' + formatTime12(parts.minutes);
}

// For display only. Rules store 24-hour HH:MM. 24:00 is the end of the day, so it
// reads as 12:00 AM like 00:00 does.
function formatTime12(totalMinutes) {
  var hours = Math.floor(totalMinutes / 60) % 24;
  var minutes = String(totalMinutes % 60);
  return (hours % 12 || 12) + ':' + (minutes.length < 2 ? '0' : '') + minutes + (hours < 12 ? ' AM' : ' PM');
}

// --- Validation ---------------------------------------------------------------
//
// Rules come from the page and are the only thing limiting what gets mirrored,
// so they are checked before they are stored and again when they are read.
// Errors reach the owner's logs, so they never repeat any part of the rule.

var RULE_TYPES = ['exact', 'contains', 'regex'];

function validateRule(rule) {
  if (!rule || typeof rule !== 'object' || RULE_TYPES.indexOf(rule.type) === -1) {
    throw new Error('Choose how to match the title.');
  }
  validateRuleTitle(rule);
  if (rule.days !== undefined) {
    validateRuleDays(rule.days);
  }
  if (rule.time !== undefined) {
    validateRuleTime(rule.time);
  }
  if (rule.date !== undefined) {
    validateRuleDate(rule.date);
  }
  // It would match every event, emptying the mirror at the next sync. The flags
  // don't matter here: this pattern matches everything with or without them.
  if (rule.type === 'regex' && rule.value === '.*' && !rule.days && !rule.time && !rule.date) {
    throw new Error('A rule for any title needs a day, time or date limit, or it would empty your mirror.');
  }
}

function validateRuleTitle(rule) {
  if (typeof rule.value !== 'string') {
    throw new Error('Enter a title.');
  }
  // Only a single-occurrence block may have a blank title: a blank exact rule
  // with no date would match every untitled event, forever.
  if (rule.value.trim() === '' && !(rule.type === 'exact' && rule.date)) {
    throw new Error('Enter a title.');
  }
  // g and y make RegExp.test() keep state between calls, which would skip matches.
  if (rule.flags !== undefined && rule.flags !== '' && rule.flags !== 'i') {
    throw new Error('The only regex option is case-insensitive.');
  }
  if (rule.type === 'regex') {
    try {
      new RegExp(rule.value, rule.flags || '');
    } catch (e) {
      throw new Error('That regular expression is not valid.');
    }
  }
}

function validateRuleDays(days) {
  var known = Array.isArray(days) && days.length > 0 && days.every(function (day) {
    return DAY_CODES.indexOf(day) !== -1;
  });
  if (!known) {
    throw new Error('Choose valid days.');
  }
}

function validateRuleTime(time) {
  if (!time || !isValidTime(time.start) || !isValidTime(time.end)) {
    throw new Error('Choose both a From time and a To time.');
  }
  if (parseTimeToMinutes(time.start) >= parseTimeToMinutes(time.end)) {
    throw new Error('The start time must be before the end time.');
  }
}

function isValidTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  var minutes = parseInt(value.substring(3), 10);
  return minutes < 60 && parseTimeToMinutes(value) <= 24 * 60;
}

function validateRuleDate(date) {
  if (!date || !isRealDate(date.start) || !isRealDate(date.end)) {
    throw new Error('Enter real dates as YYYY-MM-DD.');
  }
  if (date.end < date.start) {
    throw new Error('The end date must not be before the start date.');
  }
}

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  var pieces = value.split('-').map(function (piece) {
    return parseInt(piece, 10);
  });
  var date = new Date(Date.UTC(pieces[0], pieces[1] - 1, pieces[2]));
  return date.getUTCFullYear() === pieces[0] &&
    date.getUTCMonth() === pieces[1] - 1 &&
    date.getUTCDate() === pieces[2];
}

// A copy in one fixed shape, so equal rules give the same JSON and the same
// storage key.
function normalizeRule(rule) {
  var normalized = { type: rule.type, value: rule.value };
  if (rule.flags) {
    normalized.flags = rule.flags;
  }
  if (rule.days) {
    normalized.days = DAY_CODES.filter(function (day) {
      return rule.days.indexOf(day) !== -1;
    });
  }
  if (rule.time) {
    normalized.time = { start: rule.time.start, end: rule.time.end };
  }
  if (rule.date) {
    normalized.date = { start: rule.date.start, end: rule.date.end };
  }
  return normalized;
}

// Stored rules hold a regex as text, because a RegExp survives neither JSON nor
// google.script.run. Matching needs the real thing.
function compileRule(storedRule) {
  var compiled = normalizeRule(storedRule);
  if (compiled.type === 'regex') {
    compiled.value = new RegExp(storedRule.value, storedRule.flags || '');
  }
  return compiled;
}
