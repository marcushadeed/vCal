// Server side of the page (index.html). Deployed as a web app that runs as each
// user, so every call here reads that user's calendars and User Properties. See
// the README.
//
// Everything sent to the page is plain JSON: a Date or RegExp doesn't survive
// google.script.run. Every function except doGet() starts with loadSettings().

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('vCal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Everything the page shows. Times are formatted here rather than in the browser,
// so they use the time zone that rules are evaluated in.
function getPageData() {
  var settings = loadSettings();
  pruneExpiredRules(Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd'));

  var allCalendars = listUserCalendars();
  var warnings = [];
  var status = loadStatus();

  return {
    timeZone: CONFIG.timeZone,
    settings: {
      mirrorCalendarId: settings.mirrorCalendarId,
      mirrorMissing: isMirrorMissing(settings.mirrorCalendarId, allCalendars),
      sourceCalendars: settings.sourceCalendars,
      lookaheadDays: settings.lookaheadDays,
      previewed: settings.previewed,
      enabled: settings.enabled,
      frequency: settings.frequency,
    },
    status: status,
    stale: isRunStale(settings, status, Date.now()),
    calendars: allCalendars.filter(function (calendar) {
      return calendar.id !== settings.mirrorCalendarId;
    }),
    rules: listPageRules(),
    events: readPageEvents(settings, warnings),
    colors: VALID_EVENT_COLOR_IDS.map(function (id) {
      return { id: id, name: EVENT_COLOR_NAMES[id] };
    }),
    warnings: warnings,
  };
}

// Includes hidden calendars, because a mirror someone hid from their list still
// exists and mustn't be treated as deleted.
function listUserCalendars() {
  var calendars = [];
  var pageToken = null;
  do {
    var response = Calendar.CalendarList.list({ maxResults: 250, showHidden: true, pageToken: pageToken });
    (response.items || []).forEach(function (item) {
      calendars.push({ id: item.id, name: item.summaryOverride || item.summary });
    });
    pageToken = response.nextPageToken;
  } while (pageToken);
  return calendars;
}

// `calendars` is the unfiltered list. Pure.
function isMirrorMissing(mirrorCalendarId, calendars) {
  return Boolean(mirrorCalendarId) && !calendars.some(function (calendar) {
    return calendar.id === mirrorCalendarId;
  });
}

function listPageRules() {
  return loadStoredRules()
    .map(function (entry) {
      return { key: entry.key, rule: entry.rule, description: describeRule(entry.rule) };
    })
    .sort(function (a, b) {
      return a.description < b.description ? -1 : 1;
    });
}

// Unlike the sync, this catches a failed calendar and warns, because a page load
// can't delete anything. Warnings go only to the page, never to a log.
function readPageEvents(settings, warnings) {
  if (!settings.mirrorCalendarId || settings.sourceCalendars.length === 0) {
    return [];
  }
  var windowStart = new Date();
  var windowEnd = new Date(windowStart.getTime() + CONFIG.lookaheadDays * 24 * 60 * 60 * 1000);
  var events = [];
  settings.sourceCalendars.forEach(function (source) {
    try {
      listSourceEvents(source.id, windowStart, windowEnd).forEach(function (item) {
        events.push(toPageEvent(item, source.name));
      });
    } catch (e) {
      warnings.push(describeRunError(tagSourceError(e, source.name)));
    }
  });
  return events.sort(function (a, b) {
    return a.startMs - b.startMs;
  });
}

function toPageEvent(item, sourceName) {
  var title = item.summary || '';
  var parts = localStartParts(item.start, CONFIG.timeZone);
  return {
    title: title,
    start: item.start.date || item.start.dateTime,
    startMs: parseEventStart(item.start).getTime(),
    allDay: parts.allDay,
    day: parts.date,
    time: parts.allDay ? '' : formatMinutes(parts.minutes),
    sourceName: sourceName,
    blocked: matchesRules(title, parts),
  };
}

// --- Calendars ----------------------------------------------------------------

// The only way to set a mirror, because the sync deletes everything in the mirror
// that it didn't create. Refusing while the mirror still exists means a double
// click can't replace it.
function createMirrorCalendar() {
  var settings = loadSettings();
  if (settings.mirrorCalendarId && !isMirrorMissing(settings.mirrorCalendarId, listUserCalendars())) {
    throw new Error('You already have a mirror calendar.');
  }
  var calendar = Calendar.Calendars.insert({ summary: 'vCal mirror', timeZone: CONFIG.timeZone });
  settings.mirrorCalendarId = calendar.id;
  saveStoredSettings(settings);
}

function saveSources(sources) {
  var settings = loadSettings();
  settings.sourceCalendars = validateSources(sources, settings.mirrorCalendarId);
  saveStoredSettings(settings);
}

function saveLookaheadDays(days) {
  var settings = loadSettings();
  settings.lookaheadDays = validateLookaheadDays(days);
  saveStoredSettings(settings);
}

// --- Rules --------------------------------------------------------------------

// `oldKey` is null when adding.
function saveRule(rule, oldKey) {
  loadSettings();
  if (oldKey) {
    replaceRule(oldKey, rule);
  } else {
    addRule(rule);
  }
}

function deleteRule(key) {
  loadSettings();
  removeRule(key);
}

function blockEvent(scope, title, start, allDay) {
  loadSettings();
  var parts = localStartParts(allDay ? { date: start } : { dateTime: start }, CONFIG.timeZone);
  addRule(buildBlockRule(scope, title, parts));
}

// --- Sync lifecycle -----------------------------------------------------------

// Makes no writes to any calendar. Returns its failure instead of throwing,
// because the error can name a calendar and a thrown one reaches the owner's logs.
function previewSync() {
  try {
    var settings = loadSettings();
    assertReadyToSync(settings);
    var built = buildSyncPlan(Date.now());
    // Read again, because a preview can take minutes.
    var latest = loadStoredSettings();
    latest.previewed = true;
    saveStoredSettings(latest);
    return { preview: summarizePlan(built.plan, built.excluded) };
  } catch (e) {
    return { error: describeRunError(e) };
  }
}

function syncNow() {
  var settings = loadSettings();
  assertReadyToSync(settings);
  assertPreviewed(settings);
  try {
    return { status: runSync() || loadStatus() };
  } catch (e) {
    // runSync() has already recorded it, and the page shows the status.
    return { status: loadStatus() };
  }
}

// Replaces any existing trigger, so this also changes the frequency.
function turnOnSync(frequency) {
  var settings = loadSettings();
  assertPreviewed(settings);
  if (!Object.prototype.hasOwnProperty.call(FREQUENCY_HOURS, frequency)) {
    throw new Error('Choose how often to sync.');
  }
  removeSyncTriggers();
  var builder = ScriptApp.newTrigger('mirrorCalendarSync').timeBased();
  if (frequency === 'daily') {
    builder.everyDays(1);
  } else {
    builder.everyHours(FREQUENCY_HOURS[frequency]);
  }
  builder.create();
  settings.enabled = true;
  settings.enabledAt = new Date().toISOString();
  settings.frequency = frequency;
  saveStoredSettings(settings);
}

function pauseSync() {
  var settings = loadSettings();
  removeSyncTriggers();
  settings.enabled = false;
  saveStoredSettings(settings);
}

function assertPreviewed(settings) {
  if (!settings.previewed) {
    throw new Error('Run a preview first.');
  }
}

// getProjectTriggers() returns only the current user's triggers.
function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'mirrorCalendarSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
