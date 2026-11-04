// Blocks made from the web page (see webapp.js). A block is an ordinary
// exclusion rule in the same shape as CONFIG.rules, so matching, tests and
// dry-run logging need no second code path. CONFIG is fixed at push time, so
// these live in Script Properties instead, and mirrorCalendarSync() merges them
// in at the start of each run.
//
// Each block has its own property, keyed by a hash of the rule. That avoids the
// 9KB-per-value limit, means two saves can't overwrite each other, and makes
// blocking the same event twice harmless.
//
// Rules are matched on title and start time, so renaming an event, or moving an
// occurrence, breaks its block and the event returns to the mirror.

var BLOCK_KEY_PREFIX = 'block:';

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
  throw new Error('Unknown block scope: ' + scope);
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
    throw new Error('Invalid event start: "' + start.dateTime + '".');
  }
  return parsed;
}

// `today` is a YYYY-MM-DD string. Title blocks have no date, so never expire.
function isBlockExpired(rule, today) {
  return Boolean(rule.date) && rule.date.end < today;
}

function describeBlock(rule) {
  if (!rule.date) {
    return 'All events titled "' + rule.value + '"';
  }
  var name = rule.value.trim() === '' ? '(untitled)' : '"' + rule.value + '"';
  return name + ' on ' + rule.date.start + ' at ' + rule.time.start;
}

// --- Script Properties store --------------------------------------------------

// Returns [{ key, rule }]. Corrupt JSON throws and fails the run, like a
// malformed rule date, so it can't silently change what gets mirrored.
function loadBlocks() {
  var properties = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(properties)
    .filter(function (key) {
      return key.indexOf(BLOCK_KEY_PREFIX) === 0;
    })
    .map(function (key) {
      try {
        return { key: key, rule: JSON.parse(properties[key]) };
      } catch (e) {
        throw new Error(
          'Corrupt block in Script Properties: "' + key + '". ' +
          'Delete it under Project Settings > Script Properties.'
        );
      }
    });
}

function loadBlockRules() {
  return loadBlocks().map(function (block) {
    return block.rule;
  });
}

function addBlock(rule) {
  var json = JSON.stringify(rule);
  PropertiesService.getScriptProperties().setProperty(BLOCK_KEY_PREFIX + md5Hex(json), json);
}

function removeBlock(key) {
  // The key comes from the page, and this store could hold other properties.
  if (key.indexOf(BLOCK_KEY_PREFIX) !== 0) {
    throw new Error('Not a block key: "' + key + '".');
  }
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function pruneExpiredBlocks() {
  var today = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd');
  loadBlocks().forEach(function (block) {
    if (isBlockExpired(block.rule, today)) {
      removeBlock(block.key);
    }
  });
}
