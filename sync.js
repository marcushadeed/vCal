// Main sync entry point. Wire this to a time-driven trigger manually from
// the Apps Script UI once dry-run output has been reviewed and confirmed —
// do not add the trigger in code.

var DRY_RUN = true;

// Tag key set on every mirrored event, recording which source calendar it
// came from. Lets the next run's wipe step log an event's origin before
// deleting it (CalendarApp has no other way to know this after the fact).
var SOURCE_TAG_KEY = 'gcalDiffSourceCalendar';

function mirrorCalendarSync() {
  if (typeof CONFIG === 'undefined') {
    throw new Error(
      'CONFIG is not defined. Copy config.example.js to config.js and fill in your values.'
    );
  }

  var mirrorCalendar = CalendarApp.getCalendarById(CONFIG.mirrorCalendarId);
  if (!mirrorCalendar) {
    throw new Error('Could not find mirror calendar with ID: ' + CONFIG.mirrorCalendarId);
  }

  var windowStart = new Date();
  var windowEnd = new Date(windowStart.getTime() + CONFIG.lookaheadDays * 24 * 60 * 60 * 1000);

  // Build the full replacement list in memory before writing anything, so a
  // mid-run crash never leaves the mirror half-deleted (see CLAUDE.md).
  var partitioned = collectEvents(windowStart, windowEnd);
  var included = partitioned.included;

  if (DRY_RUN) {
    logDryRun(partitioned, mirrorCalendar, windowStart, windowEnd);
    return;
  }

  deleteExistingMirroredEvents(mirrorCalendar, windowStart, windowEnd);
  createMirroredEvents(mirrorCalendar, included);
  Logger.log('mirrorCalendarSync: created ' + included.length + ' event(s).');
}

// Splits every source event in the window into `included` (mirrored — did
// not match any blacklist rule) and `excluded` (filtered out — matched a
// blacklist rule). Rules are a blacklist: an event is mirrored by default
// unless CONFIG.rules says otherwise (see CLAUDE.md).
function collectEvents(windowStart, windowEnd) {
  var included = [];
  var excluded = [];
  CONFIG.sourceCalendars.forEach(function (source) {
    var calendar = CalendarApp.getCalendarById(source.id);
    if (!calendar) {
      Logger.log('WARNING: could not find source calendar "' + source.name + '" (' + source.id + '); skipping.');
      return;
    }
    // getEvents() expands recurring events into individual instances, so a
    // weekly meeting becomes one entry per occurrence in this window.
    var events = calendar.getEvents(windowStart, windowEnd);
    events.forEach(function (event) {
      var title = event.getTitle();
      var startTime = event.getStartTime();
      if (matchesRules(title, startTime)) {
        excluded.push({
          event: event,
          sourceName: source.name,
          rule: findMatchingRule(title, startTime),
        });
      } else {
        included.push({
          event: event,
          sourceName: source.name,
        });
      }
    });
  });
  return { included: included, excluded: excluded };
}

function logDryRun(partitioned, mirrorCalendar, windowStart, windowEnd) {
  var included = partitioned.included;
  var excluded = partitioned.excluded;

  Logger.log('=== DRY RUN: mirrorCalendarSync (no changes made) ===');
  Logger.log('Window: ' + windowStart + ' through ' + windowEnd);

  var existing = mirrorCalendar.getEvents(windowStart, windowEnd);
  Logger.log('Intended deletes: ' + existing.length);
  existing.forEach(function (event) {
    var source = event.getTag(SOURCE_TAG_KEY) || 'unknown';
    Logger.log('  DELETE "' + event.getTitle() + '" on ' + event.getStartTime() + ' (source: ' + source + ')');
  });

  Logger.log('Intended excludes (blacklisted): ' + excluded.length);
  excluded.forEach(function (match) {
    Logger.log(
      '  EXCLUDE "' + match.event.getTitle() + '" at ' + match.event.getStartTime() +
      ' (source: ' + match.sourceName + ', rule: ' + describeRule(match.rule) + ')'
    );
  });

  Logger.log('Intended creates: ' + included.length);
  included.forEach(function (match) {
    Logger.log(
      '  CREATE "' + match.event.getTitle() + '" at ' + match.event.getStartTime() +
      ' (source: ' + match.sourceName + ')'
    );
  });

  Logger.log('=== END DRY RUN ===');
}

function describeRule(rule) {
  if (!rule) {
    return 'unknown';
  }
  var value = rule.value instanceof RegExp ? rule.value.toString() : '"' + rule.value + '"';
  var desc = rule.type + ' ' + value;
  if (rule.days) {
    desc += ', days=' + rule.days.join(',');
  }
  if (rule.time) {
    desc += ', time=' + rule.time.start + '-' + rule.time.end;
  }
  return desc;
}

function deleteExistingMirroredEvents(mirrorCalendar, windowStart, windowEnd) {
  var events = mirrorCalendar.getEvents(windowStart, windowEnd);
  events.forEach(function (event) {
    var source = event.getTag(SOURCE_TAG_KEY) || 'unknown';
    Logger.log('DELETE "' + event.getTitle() + '" on ' + event.getStartTime() + ' (source: ' + source + ')');
    event.deleteEvent();
  });
}

function createMirroredEvents(mirrorCalendar, included) {
  included.forEach(function (match) {
    var source = match.event;
    var options = {
      location: source.getLocation(),
      description: source.getDescription(),
      // No `guests` key here: attendees are intentionally never copied
      // (see CLAUDE.md — copying guests causes Google to send invites
      // to them every day, forever).
    };

    var newEvent;
    if (source.isAllDayEvent()) {
      newEvent = mirrorCalendar.createAllDayEvent(
        source.getTitle(),
        source.getAllDayStartDate(),
        source.getAllDayEndDate(),
        options
      );
    } else {
      newEvent = mirrorCalendar.createEvent(
        source.getTitle(),
        source.getStartTime(),
        source.getEndTime(),
        options
      );
    }

    // Explicitly clear reminders regardless of what the source had, to
    // avoid double notifications for events the user is invited to twice.
    newEvent.removeAllReminders();
    newEvent.setTag(SOURCE_TAG_KEY, match.sourceName);

    Logger.log('CREATE "' + newEvent.getTitle() + '" at ' + newEvent.getStartTime() + ' (source: ' + match.sourceName + ')');
  });
}
