// Main sync entry point. Wire this to a time-driven trigger manually from
// the Apps Script UI once dry-run output has been reviewed and confirmed —
// do not add the trigger in code.
//
// Reconciliation is INCREMENTAL: each mirrored event carries a stable
// identity and a content signature in its private extended properties, so a
// run compares the mirror against the desired state and writes only the
// difference. A steady-state day typically writes nothing at all.

var DRY_RUN = true;

// Private extended-property keys set on every mirrored event.
//
// SOURCE_TAG_KEY records which source calendar an event came from (used for
// log lines only). SYNC_KEY is the stable identity of the source instance
// and is what the diff matches on. SIGNATURE_KEY is a hash of the mirrored
// content, so a changed source event can be detected without field-by-field
// comparison.
//
// These are the same private extended properties that CalendarApp's
// setTag()/getTag() read and write, so SOURCE_TAG_KEY stays compatible with
// tags written by earlier versions of this script.
var SOURCE_TAG_KEY = 'gcalDiffSourceCalendar';
var SYNC_KEY = 'gcalDiffSyncKey';
var SIGNATURE_KEY = 'gcalDiffSignature';

// The only values Google Calendar accepts in an event's `colorId`. These are
// the 11 per-event colours, which are a different set from the 24 calendar
// colours — an id outside this list is rejected by the API, which would fail
// every write in the run, so a configured colour is checked against it once
// per source calendar rather than trusted blindly.
//
//   1 Lavender   2 Sage      3 Grape     4 Flamingo   5 Banana   6 Tangerine
//   7 Peacock    8 Graphite  9 Blueberry 10 Basil    11 Tomato
var VALID_EVENT_COLOR_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

// Joins fields before hashing. ASCII 31 (unit separator) is a control
// character that cannot appear in a calendar title, location or description,
// so it keeps adjacent fields from running together — without a separator, a
// title ending in a space and a location starting with one would hash
// identically to a different pair of values. Written with fromCharCode
// rather than an escape so the source file stays plain ASCII.
var FIELD_SEPARATOR = String.fromCharCode(31);

// Apps Script kills an execution at 6 minutes. Stop issuing writes before
// that so a large run ends cleanly instead of being cut off mid-write.
// Incremental reconciliation is idempotent and recomputed from scratch every
// run, so whatever is left over is simply picked up by the next one.
var MAX_RUNTIME_MS = 4.5 * 60 * 1000;

function mirrorCalendarSync() {
  if (typeof CONFIG === 'undefined') {
    throw new Error(
      'CONFIG is not defined. Copy config.example.js to config.js and fill in your values.'
    );
  }

  var startedAt = Date.now();

  var windowStart = new Date();
  var windowEnd = new Date(windowStart.getTime() + CONFIG.lookaheadDays * 24 * 60 * 60 * 1000);

  var partitioned = collectEvents(windowStart, windowEnd);
  var desired = buildDesiredEvents(partitioned.included);
  var existing = fetchMirrorIndex(windowStart, windowEnd);
  var plan = buildPlan(desired, existing);

  if (DRY_RUN) {
    logDryRun(plan, partitioned.excluded, windowStart, windowEnd);
    return;
  }

  applyPlan(plan, startedAt);
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
    // Checked here, once per calendar rather than once per event, so a typo in
    // the config surfaces as one log line instead of failing every write.
    if (source.color && !isValidEventColorId(source.color)) {
      Logger.log(
        'WARNING: source calendar "' + source.name + '" has color "' + source.color +
        '", which is not one of ' + VALID_EVENT_COLOR_IDS.join('/') + '; ignoring it.'
      );
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
          sourceCalendarId: source.id,
          sourceName: source.name,
          sourceColor: source.color,
        });
      }
    });
  });
  return { included: included, excluded: excluded };
}

// Turns the included source events into the exact Calendar API resources we
// want the mirror to contain, keyed by sync key.
function buildDesiredEvents(included) {
  var desired = {};
  included.forEach(function (match) {
    var syncKey = computeSyncKey(
      match.sourceCalendarId,
      match.event.getId(),
      match.event.getStartTime()
    );

    // The colour is resolved inside buildEventResource(), i.e. BEFORE the
    // signature is computed from the finished resource. Setting it afterwards
    // would leave a colour change invisible to the diff.
    var resource = buildEventResource(match.event, match.sourceColor);
    var signature = computeSignature(resource, match.event.getLastUpdated());

    resource.extendedProperties = {
      private: {},
    };
    resource.extendedProperties.private[SYNC_KEY] = syncKey;
    resource.extendedProperties.private[SIGNATURE_KEY] = signature;
    resource.extendedProperties.private[SOURCE_TAG_KEY] = match.sourceName;

    // A duplicate key would mean two source instances we cannot tell apart;
    // last one wins, which keeps the mirror consistent rather than creating
    // two events that fight over the same identity on every run.
    desired[syncKey] = {
      syncKey: syncKey,
      signature: signature,
      resource: resource,
      sourceName: match.sourceName,
      title: match.event.getTitle(),
      startTime: match.event.getStartTime(),
      colorId: resource.colorId || '',
    };
  });
  return desired;
}

// Builds the mirrored copy of a source event: every property CalendarApp
// readily exposes that is safe to copy — title, time, location, description,
// colour and visibility. Attendees are never copied (CLAUDE.md gotcha #1)
// and reminders are always cleared (gotcha #2). Setting reminders here
// rather than with a follow-up removeAllReminders() call keeps this to a
// single write per event.
function buildEventResource(source, sourceColor) {
  var resource = {
    summary: source.getTitle(),
    location: source.getLocation() || '',
    description: source.getDescription() || '',
    reminders: {
      useDefault: false,
      overrides: [],
    },
    // No `attendees` key: attendees are intentionally never copied, because
    // Google would send invitations to them on every run, forever.
  };

  // getColor() returns '' when the event uses the calendar's default colour,
  // in which case the source calendar's configured colour is used so that the
  // mirror still shows which calendar the event came from. The API rejects an
  // empty colorId, so only set it when there is one.
  var color = resolveColorId(source.getColor(), sourceColor);
  if (color) {
    resource.colorId = color;
  }

  var visibility = mapVisibility(source.getVisibility());
  if (visibility) {
    resource.visibility = visibility;
  }

  if (source.isAllDayEvent()) {
    // All-day events use `date`, not `dateTime`. Both CalendarApp's
    // getAllDayEndDate() and the API's end.date are exclusive (the day after
    // the event ends), so these map across directly.
    var timeZone = Session.getScriptTimeZone();
    resource.start = { date: Utilities.formatDate(source.getAllDayStartDate(), timeZone, 'yyyy-MM-dd') };
    resource.end = { date: Utilities.formatDate(source.getAllDayEndDate(), timeZone, 'yyyy-MM-dd') };
  } else {
    resource.start = { dateTime: source.getStartTime().toISOString() };
    resource.end = { dateTime: source.getEndTime().toISOString() };
  }

  return resource;
}

// Decides which colour a mirrored event carries. The source event's own
// colour override wins when it has one, so per-event colour coding in the
// source survives the copy; otherwise the event takes its source calendar's
// configured colour, which is what makes sources distinguishable in the
// mirror. Returns '' for "leave unset" — the API rejects an empty colorId, so
// the caller omits the field entirely in that case.
//
// Pure, and separate from buildEventResource() for exactly that reason:
// buildEventResource() calls CalendarApp getters and cannot be unit-tested,
// this can.
function resolveColorId(eventColor, sourceColor) {
  if (isValidEventColorId(eventColor)) {
    return String(eventColor);
  }
  if (isValidEventColorId(sourceColor)) {
    return String(sourceColor);
  }
  return '';
}

// Accepts a string or a number, since a config written as `color: 5` is an
// easy mistake and means the same thing as '5'.
function isValidEventColorId(color) {
  if (color === null || color === undefined || color === '') {
    return false;
  }
  return VALID_EVENT_COLOR_IDS.indexOf(String(color)) !== -1;
}

// CalendarApp's Visibility enum uses upper-case names; the API expects
// lower-case strings. Returns '' for the default, which is left unset.
function mapVisibility(visibility) {
  if (!visibility) {
    return '';
  }
  var name = visibility.toString().toLowerCase();
  if (name === 'public' || name === 'private' || name === 'confidential') {
    return name;
  }
  return '';
}

// Reads every event currently in the mirror window, indexed by sync key.
// Events without a sync key (created by an older version of this script, or
// added by hand) are returned separately as `untracked` — the mirror
// calendar is treated as owned by this script, so those are cleaned up.
function fetchMirrorIndex(windowStart, windowEnd) {
  var tracked = {};
  var untracked = [];
  var pageToken = null;

  do {
    var response = Calendar.Events.list(CONFIG.mirrorCalendarId, {
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      maxResults: 2500,
      pageToken: pageToken,
    });

    (response.items || []).forEach(function (item) {
      var privateProps = (item.extendedProperties && item.extendedProperties.private) || {};
      var syncKey = privateProps[SYNC_KEY];
      var entry = {
        id: item.id,
        syncKey: syncKey,
        signature: privateProps[SIGNATURE_KEY],
        sourceName: privateProps[SOURCE_TAG_KEY] || 'unknown',
        title: item.summary,
        start: (item.start && (item.start.dateTime || item.start.date)) || 'unknown',
        colorId: item.colorId || '',
      };
      if (syncKey) {
        tracked[syncKey] = entry;
      } else {
        untracked.push(entry);
      }
    });

    pageToken = response.nextPageToken;
  } while (pageToken);

  return { tracked: tracked, untracked: untracked };
}

// Diffs desired against existing. Anything in the mirror that no longer
// corresponds to a desired event is deleted; anything whose signature moved
// is updated; everything else is left completely untouched.
function buildPlan(desired, existing) {
  var creates = [];
  var updates = [];
  var deletes = [];
  var unchanged = 0;

  Object.keys(desired).forEach(function (syncKey) {
    var want = desired[syncKey];
    var have = existing.tracked[syncKey];
    if (!have) {
      creates.push(want);
    } else if (have.signature !== want.signature) {
      updates.push({ id: have.id, desired: want, previous: have });
    } else {
      unchanged++;
    }
  });

  Object.keys(existing.tracked).forEach(function (syncKey) {
    if (!desired[syncKey]) {
      deletes.push(existing.tracked[syncKey]);
    }
  });

  // Events with no sync key predate incremental reconciliation (or were
  // added by hand). Removing them lets the first run after this upgrade
  // rebuild the mirror once into the tracked format.
  existing.untracked.forEach(function (entry) {
    deletes.push(entry);
  });

  return { creates: creates, updates: updates, deletes: deletes, unchanged: unchanged };
}

function logDryRun(plan, excluded, windowStart, windowEnd) {
  Logger.log('=== DRY RUN: mirrorCalendarSync (no changes made) ===');
  Logger.log('Window: ' + windowStart + ' through ' + windowEnd);
  Logger.log(
    'Summary: ' + plan.creates.length + ' create(s), ' + plan.updates.length + ' update(s), ' +
    plan.deletes.length + ' delete(s), ' + plan.unchanged + ' unchanged, ' +
    excluded.length + ' excluded by rules.'
  );

  Logger.log('Intended creates: ' + plan.creates.length);
  plan.creates.forEach(function (item) {
    Logger.log(
      '  CREATE "' + item.title + '" at ' + item.startTime +
      ' (source: ' + item.sourceName + ', colour: ' + describeColor(item.colorId) + ')'
    );
  });

  Logger.log('Intended updates: ' + plan.updates.length);
  plan.updates.forEach(function (item) {
    Logger.log(
      '  UPDATE "' + item.desired.title + '" at ' + item.desired.startTime +
      ' (source: ' + item.desired.sourceName + ', colour: ' + describeColor(item.desired.colorId) +
      ', was "' + item.previous.title + '" at ' + item.previous.start +
      ' colour ' + describeColor(item.previous.colorId) + ')'
    );
  });

  Logger.log('Intended deletes: ' + plan.deletes.length);
  plan.deletes.forEach(function (item) {
    var reason = item.syncKey ? 'no longer in source' : 'untracked (pre-incremental or manually added)';
    Logger.log('  DELETE "' + item.title + '" on ' + item.start + ' (source: ' + item.sourceName + ', ' + reason + ')');
  });

  Logger.log('Unchanged (left alone): ' + plan.unchanged);

  Logger.log('Excluded (blacklisted): ' + excluded.length);
  excluded.forEach(function (match) {
    Logger.log(
      '  EXCLUDE "' + match.event.getTitle() + '" at ' + match.event.getStartTime() +
      ' (source: ' + match.sourceName + ', rule: ' + describeRule(match.rule) + ')'
    );
  });

  Logger.log('=== END DRY RUN ===');
}

// Names the event colours in dry-run output, so a colour-only update reads as
// "Banana -> Basil" rather than "5 -> 10".
var EVENT_COLOR_NAMES = {
  '1': 'Lavender', '2': 'Sage', '3': 'Grape', '4': 'Flamingo',
  '5': 'Banana', '6': 'Tangerine', '7': 'Peacock', '8': 'Graphite',
  '9': 'Blueberry', '10': 'Basil', '11': 'Tomato',
};

function describeColor(colorId) {
  if (!colorId) {
    return 'calendar default';
  }
  var name = EVENT_COLOR_NAMES[String(colorId)];
  return name ? name + ' (' + colorId + ')' : String(colorId);
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

// Applies the plan, stopping cleanly if the run approaches the Apps Script
// execution limit. Creates and updates run before deletes so that running
// out of time leaves the mirror with extra stale events rather than missing
// ones — and because the plan is recomputed from scratch every run, the
// remainder is simply completed by the next one.
function applyPlan(plan, startedAt) {
  var counts = { created: 0, updated: 0, deleted: 0, deferred: 0 };

  var outOfTime = function () {
    return Date.now() - startedAt > MAX_RUNTIME_MS;
  };

  for (var i = 0; i < plan.creates.length; i++) {
    if (outOfTime()) {
      counts.deferred += plan.creates.length - i;
      return finishRun(plan, counts, true);
    }
    var create = plan.creates[i];
    Calendar.Events.insert(create.resource, CONFIG.mirrorCalendarId);
    counts.created++;
    Logger.log('CREATE "' + create.title + '" at ' + create.startTime + ' (source: ' + create.sourceName + ')');
  }

  for (var j = 0; j < plan.updates.length; j++) {
    if (outOfTime()) {
      counts.deferred += plan.updates.length - j;
      return finishRun(plan, counts, true);
    }
    var update = plan.updates[j];
    Calendar.Events.update(update.desired.resource, CONFIG.mirrorCalendarId, update.id);
    counts.updated++;
    Logger.log('UPDATE "' + update.desired.title + '" at ' + update.desired.startTime + ' (source: ' + update.desired.sourceName + ')');
  }

  for (var k = 0; k < plan.deletes.length; k++) {
    if (outOfTime()) {
      counts.deferred += plan.deletes.length - k;
      return finishRun(plan, counts, true);
    }
    var remove = plan.deletes[k];
    Calendar.Events.remove(CONFIG.mirrorCalendarId, remove.id);
    counts.deleted++;
    Logger.log('DELETE "' + remove.title + '" on ' + remove.start + ' (source: ' + remove.sourceName + ')');
  }

  return finishRun(plan, counts, false);
}

function finishRun(plan, counts, ranOutOfTime) {
  Logger.log(
    'mirrorCalendarSync: ' + counts.created + ' created, ' + counts.updated + ' updated, ' +
    counts.deleted + ' deleted, ' + plan.unchanged + ' unchanged.'
  );
  if (ranOutOfTime) {
    Logger.log(
      'NOTE: stopped early to stay under the Apps Script execution limit. ' +
      counts.deferred + ' change(s) deferred to the next run. Run again to continue.'
    );
  }
}

// --- Identity and change detection (pure — no CalendarApp, no API) --------

// Stable identity for one source event instance.
//
// CalendarApp's getId() returns the event's iCalUID, and every occurrence of
// a recurring series shares a single iCalUID. The start time is therefore
// required to tell instances apart — without it, all ~75 meetings of a
// recurring course would collapse onto one key.
//
// A source event that is rescheduled gets a new key, so it appears as a
// delete plus a create rather than an update. That is slightly less
// efficient than matching it through the move, but it keeps identity
// entirely derivable from the source with no stored mapping.
function computeSyncKey(sourceCalendarId, sourceEventId, startTime) {
  return md5Hex([sourceCalendarId, sourceEventId, startTime.toISOString()].join(FIELD_SEPARATOR));
}

// Hash of every readily available property of the source event, so that any
// edit on the source side propagates to the mirror on the next run.
//
// Two layers, deliberately:
//
//  1. Every mirrored field — title, location, description, start, end,
//     all-day flag, colour, visibility. A change to any of these changes the
//     hash, and the diff rewrites the mirrored copy.
//  2. The source event's own last-modified timestamp, as a catch-all. This
//     covers edits to properties this script does not read at all, so a
//     source event can never drift silently out of sync just because the
//     changed field is not one of the ones enumerated above.
//
// Layer 2 means an edit that does not affect the mirrored copy still costs
// one rewrite. That is the intended trade: correctness over saving a write,
// which incremental reconciliation has made cheap. Note that editing one
// occurrence of a recurring series can bump lastUpdated for every occurrence,
// producing a burst of rewrites on the following run — bounded, self-limiting
// (they are stable again on the run after), and covered by the runtime guard
// in applyPlan().
function computeSignature(resource, sourceLastUpdated) {
  var parts = [
    resource.summary,
    resource.location,
    resource.description,
    resource.start.dateTime || resource.start.date,
    resource.end.dateTime || resource.end.date,
    resource.start.date ? 'all-day' : 'timed',
    resource.colorId || '',
    resource.visibility || '',
    sourceLastUpdated ? sourceLastUpdated.toISOString() : '',
  ];
  return md5Hex(parts.join(FIELD_SEPARATOR));
}

function md5Hex(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    // computeDigest returns signed bytes; shift back into 0-255 before hex.
    var value = (byte < 0 ? byte + 256 : byte).toString(16);
    return value.length === 1 ? '0' + value : value;
  }).join('');
}
