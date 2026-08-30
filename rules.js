// Pure title/time filter logic. No CalendarApp calls here — this file must
// be testable by calling matchesRules() directly with plain values.
//
// CONFIG.rules is a BLACKLIST: an event is mirrored unless it matches one
// of these rules. matchesRules() returns true when the title (and, if the
// rule specifies them, day/time) matches a rule, meaning the event should
// be EXCLUDED from the mirror — not included.
//
// The only external state this depends on is CONFIG.rules (see
// config.example.js for the rule shape). Everything else is a function of
// its arguments.

var DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function matchesRules(title, startTime) {
  return CONFIG.rules.some(function (rule) {
    return ruleMatchesTitle(rule, title) &&
      ruleMatchesDay(rule, startTime) &&
      ruleMatchesTime(rule, startTime);
  });
}

// Returns the first rule in CONFIG.rules that matches, or null. Used only
// for dry-run/exclusion logging (CLAUDE.md wants the matching exclusion
// rule named in the log), so it isn't part of the pure matchesRules()
// contract itself.
function findMatchingRule(title, startTime) {
  var rules = CONFIG.rules;
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (ruleMatchesTitle(rule, title) && ruleMatchesDay(rule, startTime) && ruleMatchesTime(rule, startTime)) {
      return rule;
    }
  }
  return null;
}

function ruleMatchesTitle(rule, title) {
  if (rule.type === 'exact') {
    return title.trim() === rule.value.trim();
  }
  if (rule.type === 'regex') {
    return rule.value.test(title);
  }
  throw new Error('Unknown rule type: ' + rule.type);
}

function ruleMatchesDay(rule, startTime) {
  if (!rule.days) {
    return true;
  }
  var dayCode = DAY_CODES[startTime.getDay()];
  return rule.days.indexOf(dayCode) !== -1;
}

function ruleMatchesTime(rule, startTime) {
  if (!rule.time) {
    return true;
  }
  var minutes = startTime.getHours() * 60 + startTime.getMinutes();
  var start = parseTimeToMinutes(rule.time.start);
  var end = parseTimeToMinutes(rule.time.end);
  return minutes >= start && minutes < end;
}

function parseTimeToMinutes(hhmm) {
  var parts = hhmm.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}
