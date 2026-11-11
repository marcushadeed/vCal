// The rule store. Rules made in the page's form and by its Block buttons are one
// list of plain JSON, per user, in User Properties. loadSettings() compiles them
// into CONFIG.rules at the start of every entry point.
//
// Each rule has its own property, keyed by a hash of the rule. That avoids the
// 9KB-per-value limit, means two saves can't overwrite each other, and makes
// adding the same rule twice harmless.
//
// Rules are matched on title and start time, so renaming an event, or moving an
// occurrence, breaks its block and the event returns to the mirror.

var RULE_KEY_PREFIX = 'rule:';
var REMOVED_RULES_KEY = 'removedRules';

// Rules match on an event's start date, but a sync also reads events that started
// earlier and are still running. So a rule outlives its date range by this long,
// or a multi-day event it excluded would return to the mirror part way through.
var RULE_EXPIRY_GRACE_DAYS = 30;

// --- Pure ---------------------------------------------------------------------

// scope 'title' blocks every event with this title, on any source calendar.
// scope 'occurrence' blocks only events with this title starting in this minute.
// `parts` comes from localStartParts().
function buildBlockRule(scope, title, parts) {
  if (scope === 'title') {
    // An exact rule on an empty title would block every untitled event.
    if (title.trim() === '') {
      throw new Error('Cannot block all events with an empty title. Block a single occurrence instead.');
    }
    return { type: 'exact', value: title };
  }
  if (scope === 'occurrence') {
    return {
      type: 'exact',
      value: title,
      date: { start: parts.date, end: parts.date },
      // A 23:59 start gives an end of 24:00, which parseTimeToMinutes() handles.
      time: { start: formatMinutes(parts.minutes), end: formatMinutes(parts.minutes + 1) },
    };
  }
  throw new Error('Unknown block scope.');
}

function formatMinutes(totalMinutes) {
  var hours = String(Math.floor(totalMinutes / 60));
  var minutes = String(totalMinutes % 60);
  return (hours.length < 2 ? '0' : '') + hours + ':' + (minutes.length < 2 ? '0' : '') + minutes;
}

// Turns a Calendar API start ({ date } or { dateTime }) into a Date. An all-day
// date is built from its parts because new Date('2026-12-25') is UTC midnight,
// which is Dec 24 in New York, and the block would land on the wrong day.
function parseEventStart(start) {
  if (start.date) {
    assertValidDate(start.date);
    var parts = start.date.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  var parsed = new Date(start.dateTime);
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid event start.');
  }
  return parsed;
}

// `today` is a YYYY-MM-DD string. Rules with no date never expire.
function isBlockExpired(rule, today) {
  if (!rule.date) {
    return false;
  }
  var end = rule.date.end.split('-').map(Number);
  var keepUntil = new Date(Date.UTC(end[0], end[1] - 1, end[2] + RULE_EXPIRY_GRACE_DAYS));
  return keepUntil.toISOString().slice(0, 10) < today;
}

function describeRemovedRules(count) {
  return count === 1
    ? '1 saved rule could not be read and was removed, so events it excluded may return to your mirror.'
    : count + ' saved rules could not be read and were removed, so events they excluded may return to your mirror.';
}

// Reads a property's value. Returns null when it can't be used as a rule.
function parseStoredRule(json) {
  try {
    var rule = JSON.parse(json);
    validateRule(rule);
    return rule;
  } catch (e) {
    return null;
  }
}

// Accepts a stored rule or a compiled one.
function describeRule(rule) {
  if (isOccurrenceRule(rule)) {
    var name = rule.value.trim() === '' ? '(untitled)' : '"' + rule.value + '"';
    return name + ' on ' + rule.date.start + ' at ' + formatTime12(parseTimeToMinutes(rule.time.start));
  }
  var pieces = [describeRuleTitle(rule)];
  if (rule.days) {
    pieces.push('on ' + rule.days.join(', '));
  }
  if (rule.time) {
    pieces.push('from ' + formatTime12(parseTimeToMinutes(rule.time.start)) +
      ' to ' + formatTime12(parseTimeToMinutes(rule.time.end)));
  }
  if (rule.date) {
    pieces.push(rule.date.start === rule.date.end ? rule.date.start : rule.date.start + ' to ' + rule.date.end);
  }
  return pieces.join(', ');
}

// What the page's Block this button makes: one title, one date, one minute.
function isOccurrenceRule(rule) {
  return rule.type === 'exact' && !rule.days && Boolean(rule.date) && Boolean(rule.time) &&
    rule.date.start === rule.date.end &&
    parseTimeToMinutes(rule.time.end) - parseTimeToMinutes(rule.time.start) === 1;
}

function describeRuleTitle(rule) {
  if (rule.type === 'regex') {
    var stored = typeof rule.value === 'string';
    var pattern = stored ? rule.value : rule.value.source;
    var flags = stored ? (rule.flags || '') : rule.value.flags;
    return pattern === '.*' && !flags ? 'All events' : 'Titles matching /' + pattern + '/' + flags;
  }
  if (rule.type === 'contains') {
    return 'Titles containing "' + rule.value + '"';
  }
  return rule.value.trim() === '' ? 'Untitled events' : 'All events titled "' + rule.value + '"';
}

// --- User Properties store ----------------------------------------------------

// Returns [{ key, rule }], with rules in their stored form. An unreadable rule
// is deleted rather than failing the run: users have no editor to repair one,
// and the worst outcome is that its events return to the mirror. The page tells
// the user how many went. The log holds only a count, because the owner can read
// every user's logs.
function loadStoredRules() {
  var store = PropertiesService.getUserProperties();
  var properties = store.getProperties();
  var loaded = [];
  var removed = 0;
  Object.keys(properties).forEach(function (key) {
    if (key.indexOf(RULE_KEY_PREFIX) !== 0) {
      return;
    }
    var rule = parseStoredRule(properties[key]);
    if (rule === null) {
      store.deleteProperty(key);
      removed++;
    } else {
      loaded.push({ key: key, rule: rule });
    }
  });
  if (removed > 0) {
    store.setProperty(REMOVED_RULES_KEY, String(loadRemovedRuleCount() + removed));
    Logger.log('Removed ' + removed + ' unreadable stored entries.');
  }
  return loaded;
}

// How many rules were removed since the user last dismissed the page's notice.
function loadRemovedRuleCount() {
  return Number(PropertiesService.getUserProperties().getProperty(REMOVED_RULES_KEY)) || 0;
}

function clearRemovedRuleCount() {
  PropertiesService.getUserProperties().deleteProperty(REMOVED_RULES_KEY);
}

function loadRules() {
  return loadStoredRules().map(function (entry) {
    return compileRule(entry.rule);
  });
}

function addRule(rule) {
  validateRule(rule);
  var json = JSON.stringify(normalizeRule(rule));
  var key = RULE_KEY_PREFIX + md5Hex(json);
  PropertiesService.getUserProperties().setProperty(key, json);
  return key;
}

// Keys are content hashes, so an edit is a new rule plus a delete of the old one.
// An edit that changes nothing gives the same key, which must not be deleted.
function replaceRule(oldKey, rule) {
  assertRuleKey(oldKey);
  var key = addRule(rule);
  if (key !== oldKey) {
    removeRule(oldKey);
  }
  return key;
}

function removeRule(key) {
  assertRuleKey(key);
  PropertiesService.getUserProperties().deleteProperty(key);
}

// The key comes from the page, and this store also holds settings and status.
function assertRuleKey(key) {
  if (typeof key !== 'string' || key.indexOf(RULE_KEY_PREFIX) !== 0) {
    throw new Error('Not a rule key.');
  }
}

function pruneExpiredRules(today) {
  loadStoredRules().forEach(function (entry) {
    if (isBlockExpired(entry.rule, today)) {
      removeRule(entry.key);
    }
  });
}
