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
  throw new Error('Unknown rule type: ' + rule.type);
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
    throw new Error('Invalid date in rule: "' + value + '". Expected YYYY-MM-DD.');
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
  return parts.allDay ? parts.date : parts.date + ' ' + formatMinutes(parts.minutes);
}
