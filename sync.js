// The sync. mirrorCalendarSync() is the trigger entry point, and the page creates
// each user's trigger once they've seen a preview.
//
// Reconciliation is INCREMENTAL: each mirrored event carries a stable
// identity and a content signature in its private extended properties, so a
// run compares the mirror against the desired state and writes only the
// difference. A steady-state day typically writes nothing at all.

// Private extended-property keys set on every mirrored event.
//
// SOURCE_TAG_KEY records which source calendar an event came from (shown in a
// preview only). SYNC_KEY is the stable identity of the source instance
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

// The trigger entry point. A leftover trigger can't write anything once sync is
// paused, because this returns before loading anything else.
function mirrorCalendarSync() {
  if (!loadStoredSettings().enabled) {
    return;
  }
  runSync();
}

// One real sync, from a trigger or the page's Sync now. Returns the status, or
// null when another run holds the lock, which isn't an error: Sync now can overlap
// a scheduled run. Failures are recorded so the page can show them, then rethrown.
function runSync() {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(0)) {
    return null;
  }
  try {
    var startedAt = Date.now();
    assertReadyToSync(loadSettings());
    var built = buildSyncPlan(startedAt);
    logTiming('applyPlan start', startedAt);
    var counts = applyPlan(built.plan, startedAt);
    logTiming('applyPlan done', startedAt);
    var status = {
      lastRunAt: new Date().toISOString(),
      created: counts.created,
      updated: counts.updated,
      deleted: counts.deleted,
      unchanged: counts.unchanged,
      deferred: counts.deferred,
      error: '',
    };
    recordStatus(status);
    return status;
  } catch (e) {
    recordStatus({
      lastRunAt: new Date().toISOString(),
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      deferred: 0,
      error: describeRunError(e),
    });
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// Computes what a sync would change, without writing anything, so that Preview and
// a real sync can't disagree. Expects loadSettings() to have run.
function buildSyncPlan(startedAt) {
  logTiming('run start', startedAt);

  var windowStart = new Date();
  var windowEnd = new Date(windowStart.getTime() + CONFIG.lookaheadDays * 24 * 60 * 60 * 1000);

  var partitioned = collectEvents(windowStart, windowEnd, startedAt);
  var desired = buildDesiredEvents(partitioned.included, startedAt);
  var existing = fetchMirrorIndex(windowStart, windowEnd);
  logTiming('fetchMirrorIndex done', startedAt);
  var plan = buildPlan(desired, existing);
  logTiming(
    'buildPlan done: ' + plan.creates.length + ' create(s), ' + plan.updates.length + ' update(s), ' +
    plan.deletes.length + ' delete(s), ' + plan.unchanged + ' unchanged',
    startedAt
  );
  // Deletes come from the mirror, so they need local times for the page. Only
  // deletes, because a steady-state run shouldn't format every mirrored event.
  plan.deletes.forEach(function (entry) {
    if (entry.rawStart) {
      entry.startLabel = describeStart(localStartParts(entry.rawStart, CONFIG.timeZone));
    }
  });
  return { plan: plan, excluded: partitioned.excluded };
}

// The plan as plain strings, for the page. Holds calendar text, so it goes to the
// page and never to a log.
function summarizePlan(plan, excluded) {
  var row = function (entry, start, reason) {
    return { title: entry.title || '', start: start, source: entry.sourceName, reason: reason };
  };
  return {
    counts: {
      creates: plan.creates.length,
      updates: plan.updates.length,
      deletes: plan.deletes.length,
      unchanged: plan.unchanged,
      excluded: excluded.length,
    },
    creates: plan.creates.map(function (entry) {
      return row(entry, entry.startLabel, 'In a source calendar, not yet in the mirror');
    }),
    updates: plan.updates.map(function (entry) {
      return row(entry.desired, entry.desired.startLabel, 'Changed in its source calendar');
    }),
    deletes: plan.deletes.map(function (entry) {
      var reason = entry.syncKey ? 'No longer in a source calendar, or now excluded by a rule' : 'Not created by vCal';
      return row(entry, entry.startLabel || entry.start, reason);
    }),
    excludes: excluded.map(function (entry) {
      return row(entry, entry.startLabel, describeRule(entry.rule));
    }),
  };
}

// The calendar's name goes on a separate property, because the message itself
// reaches the owner's logs when the error is rethrown.
function tagSourceError(e, sourceName) {
  e.sourceName = sourceName;
  return e;
}

// What the page shows for a failed run.
function describeRunError(e) {
  var message = (e && e.message) || String(e);
  return e && e.sourceName ? 'Could not read "' + e.sourceName + '": ' + message : message;
}

// Records how far a run got (issue #7). When Apps Script kills an execution,
// the last line logged shows where it stopped. Uses console.log rather than
// Logger.log so the line goes to Cloud Logging as it is emitted, in case
// Logger output does not survive the kill.
//
// The owner can read every user's logs, so labels hold only counts and calendar
// numbers, never event titles, calendar names, calendar ids or rule text.
function logTiming(label, startedAt) {
  console.log('[timing ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's] ' + label);
}

// Splits every source event in the window into `included` (mirrored — did
// not match any blacklist rule) and `excluded` (filtered out — matched a
// blacklist rule). Rules are a blacklist: an event is mirrored by default
// unless CONFIG.rules says otherwise (see CLAUDE.md).
function collectEvents(windowStart, windowEnd, startedAt) {
  var included = [];
  var excluded = [];
  CONFIG.sourceCalendars.forEach(function (source, sourceIndex) {
    var label = 'calendar ' + (sourceIndex + 1);
    // Checked here, once per calendar rather than once per event, so a bad value
    // surfaces as one log line instead of failing every write.
    if (source.color && !isValidEventColorId(source.color)) {
      Logger.log('WARNING: ' + label + ' has an invalid colour; ignoring it.');
    }
    // Errors always propagate, tagged so the page can name the calendar. Skipping
    // an unreadable calendar would leave its events out of the desired state, and
    // the diff would then delete all of their mirrored copies, even on a temporary
    // API error.
    logTiming('list start: ' + label, startedAt);
    var items;
    try {
      items = listSourceEvents(source.id, windowStart, windowEnd);
    } catch (e) {
      throw tagSourceError(e, source.name);
    }
    logTiming('list done: ' + label + ', ' + items.length + ' event(s)', startedAt);
    items.forEach(function (item) {
      var title = item.summary || '';
      // Rules follow the user's time zone. The sync key keeps parseEventStart(),
      // so that it stays stable.
      var parts = localStartParts(item.start, CONFIG.timeZone);
      var startTime = parseEventStart(item.start);
      if (matchesRules(title, parts)) {
        excluded.push({
          title: title,
          startTime: startTime,
          startLabel: describeStart(parts),
          sourceName: source.name,
          rule: findMatchingRule(title, parts),
        });
      } else {
        included.push({
          item: item,
          title: title,
          startTime: startTime,
          startLabel: describeStart(parts),
          sourceCalendarId: source.id,
          sourceName: source.name,
          sourceColor: source.color,
        });
      }
    });
    logTiming('filter done: ' + label, startedAt);
  });
  return { included: included, excluded: excluded };
}

// Reads a calendar's events and all their fields in one paginated call.
// singleEvents expands recurring events into individual instances, so a weekly
// meeting becomes one entry per occurrence in this window. This replaces
// CalendarApp, whose per-event getters took a run past the 6-minute limit
// (issue #7).
function listSourceEvents(calendarId, windowStart, windowEnd) {
  var items = [];
  var pageToken = null;
  do {
    var response = Calendar.Events.list(calendarId, {
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken: pageToken,
    });
    items = items.concat(response.items || []);
    pageToken = response.nextPageToken;
  } while (pageToken);
  return items;
}

// Turns the included source events into the exact Calendar API resources we
// want the mirror to contain, keyed by sync key.
function buildDesiredEvents(included, startedAt) {
  var desired = {};
  included.forEach(function (match, index) {
    var syncKey = computeSyncKey(match.sourceCalendarId, match.item.iCalUID, match.startTime);

    // The colour is resolved inside buildEventResource(), i.e. BEFORE the
    // signature is computed from the finished resource. Setting it afterwards
    // would leave a colour change invisible to the diff.
    var resource = buildEventResource(match.item, match.sourceColor);
    var signature = computeSignature(resource, match.item.updated ? new Date(match.item.updated) : null);

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
      title: match.title,
      startTime: match.startTime,
      startLabel: match.startLabel,
      colorId: resource.colorId || '',
    };

    if ((index + 1) % 100 === 0) {
      logTiming('buildDesiredEvents: ' + (index + 1) + ' of ' + included.length, startedAt);
    }
  });
  logTiming('buildDesiredEvents done: ' + included.length + ' event(s)', startedAt);
  return desired;
}

// Builds the mirrored copy of a source event from its Calendar API item: title,
// time, location, description, colour and visibility. Attendees are never
// copied (CLAUDE.md gotcha #1) and reminders are always cleared (gotcha #2).
// Pure, so it is covered by testBuildEventResource().
function buildEventResource(item, sourceColor) {
  var resource = {
    summary: item.summary || '',
    location: item.location || '',
    description: item.description || '',
    reminders: {
      useDefault: false,
      overrides: [],
    },
    // No `attendees` key: attendees are intentionally never copied, because
    // Google would send invitations to them on every run, forever.
  };

  // An item has no colorId when the event uses the calendar's default colour,
  // in which case the source calendar's configured colour is used so that the
  // mirror still shows which calendar the event came from. The API rejects an
  // empty colorId, so only set it when there is one.
  var color = resolveColorId(item.colorId, sourceColor);
  if (color) {
    resource.colorId = color;
  }

  var visibility = mapVisibility(item.visibility);
  if (visibility) {
    resource.visibility = visibility;
  }

  if (item.start.date) {
    // All-day events use `date`, not `dateTime`. end.date is already exclusive
    // (the day after the event ends), so it is copied as is.
    resource.start = { date: item.start.date };
    resource.end = { date: item.end.date };
  } else {
    // Normalised to UTC because the API returns these with an offset, and
    // computeSignature() hashes the string: the same instant written another
    // way would make every mirrored event look changed.
    resource.start = { dateTime: new Date(item.start.dateTime).toISOString() };
    resource.end = { dateTime: new Date(item.end.dateTime).toISOString() };
  }

  return resource;
}

// Decides which colour a mirrored event carries. The source event's own
// colour override wins when it has one, so per-event colour coding in the
// source survives the copy; otherwise the event takes its source calendar's
// configured colour, which is what makes sources distinguishable in the
// mirror. Returns '' for "leave unset" — the API rejects an empty colorId, so
// the caller omits the field entirely in that case.
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

// Returns '' for the default, which is left unset.
function mapVisibility(visibility) {
  if (visibility === 'public' || visibility === 'private' || visibility === 'confidential') {
    return visibility;
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
        rawStart: item.start,
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

// Names for the event colours, for the page's colour dropdown.
var EVENT_COLOR_NAMES = {
  '1': 'Lavender', '2': 'Sage', '3': 'Grape', '4': 'Flamingo',
  '5': 'Banana', '6': 'Tangerine', '7': 'Peacock', '8': 'Graphite',
  '9': 'Blueberry', '10': 'Basil', '11': 'Tomato',
};

// Applies the plan, stopping cleanly if the run approaches the Apps Script
// execution limit. Creates and updates run before deletes so that running
// out of time leaves the mirror with extra stale events rather than missing
// ones — and because the plan is recomputed from scratch every run, the
// remainder is simply completed by the next one. Returns the counts.
function applyPlan(plan, startedAt) {
  var counts = { created: 0, updated: 0, deleted: 0, unchanged: plan.unchanged, deferred: 0 };

  var outOfTime = function () {
    return Date.now() - startedAt > MAX_RUNTIME_MS;
  };

  for (var i = 0; i < plan.creates.length; i++) {
    if (outOfTime()) {
      return finishRun(plan, counts, true);
    }
    var create = plan.creates[i];
    Calendar.Events.insert(create.resource, CONFIG.mirrorCalendarId);
    counts.created++;
  }

  for (var j = 0; j < plan.updates.length; j++) {
    if (outOfTime()) {
      return finishRun(plan, counts, true);
    }
    var update = plan.updates[j];
    Calendar.Events.update(update.desired.resource, CONFIG.mirrorCalendarId, update.id);
    counts.updated++;
  }

  for (var k = 0; k < plan.deletes.length; k++) {
    if (outOfTime()) {
      return finishRun(plan, counts, true);
    }
    var remove = plan.deletes[k];
    Calendar.Events.remove(CONFIG.mirrorCalendarId, remove.id);
    counts.deleted++;
  }

  return finishRun(plan, counts, false);
}

function finishRun(plan, counts, ranOutOfTime) {
  // Everything planned but not done, whichever step the run stopped in.
  counts.deferred = plan.creates.length + plan.updates.length + plan.deletes.length -
    counts.created - counts.updated - counts.deleted;
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
  return counts;
}

// --- Identity and change detection (pure — no CalendarApp, no API) --------

// Stable identity for one source event instance.
//
// Every occurrence of a recurring series shares a single iCalUID (only the
// API event ids are distinct). The start time is therefore
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
