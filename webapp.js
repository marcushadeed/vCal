// Server side of the page (index.html). Deployed as a web app that runs as each
// user, so every call here reads that user's calendars and User Properties. See
// the README.
//
// Everything sent to the page is plain JSON: a Date or RegExp doesn't survive
// google.script.run. Every function except doGet() and getSyncProgress() starts
// with loadSettings().

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
  var removedRules = loadRemovedRuleCount();

  return {
    timeZone: CONFIG.timeZone,
    settings: {
      mirrorCalendarId: settings.mirrorCalendarId,
      mirrorMissing: isMirrorMissing(settings.mirrorCalendarId, allCalendars),
      mirrorName: findMirrorName(settings.mirrorCalendarId, allCalendars),
      defaultMirrorName: DEFAULT_MIRROR_NAME,
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
    removedRulesNotice: removedRules > 0 ? describeRemovedRules(removedRules) : '',
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

// `calendars` is the unfiltered list. '' when there's no mirror. Pure.
function findMirrorName(mirrorCalendarId, calendars) {
  for (var i = 0; i < calendars.length; i++) {
    if (mirrorCalendarId && calendars[i].id === mirrorCalendarId) {
      return calendars[i].name || '';
    }
  }
  return '';
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
  return events.sort(comparePageEvents);
}

// By the day and time the page shows, with all-day events (no time) first. An
// all-day event's instant follows the script's time zone, so sorting by instant
// would split a day's events under two headings for users elsewhere. `minutes`
// is -1 for an all-day event. Pure.
function comparePageEvents(a, b) {
  if (a.day !== b.day) {
    return a.day < b.day ? -1 : 1;
  }
  return a.minutes - b.minutes;
}

function toPageEvent(item, sourceName) {
  var title = item.summary || '';
  var parts = localStartParts(item.start, CONFIG.timeZone);
  return {
    title: title,
    start: item.start.date || item.start.dateTime,
    allDay: parts.allDay,
    day: parts.date,
    minutes: parts.allDay ? -1 : parts.minutes,
    time: parts.allDay ? '' : formatTime12(parts.minutes),
    sourceName: sourceName,
    blocked: matchesRules(title, parts),
  };
}

// --- Calendars ----------------------------------------------------------------

// The only way to set a mirror, because the sync deletes everything in the mirror
// that it didn't create. Refusing while the mirror still exists means a double
// click can't replace it.
function createMirrorCalendar(name) {
  var settings = loadSettings();
  var summary = validateMirrorName(name);
  if (settings.mirrorCalendarId && !isMirrorMissing(settings.mirrorCalendarId, listUserCalendars())) {
    throw new Error('You already have a mirror calendar.');
  }
  var calendar = Calendar.Calendars.insert({ summary: summary, timeZone: CONFIG.timeZone });
  settings.mirrorCalendarId = calendar.id;
  saveStoredSettings(settings);
}

// Changes the calendar's own name rather than this user's override of it, so
// people it's shared with see the new name too.
function renameMirrorCalendar(name) {
  var settings = loadSettings();
  var summary = validateMirrorName(name);
  if (!settings.mirrorCalendarId || isMirrorMissing(settings.mirrorCalendarId, listUserCalendars())) {
    throw new Error('Create a mirror calendar first.');
  }
  Calendar.Calendars.patch({ summary: summary }, settings.mirrorCalendarId);
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

function dismissRemovedRules() {
  loadSettings();
  clearRemovedRuleCount();
}

// --- Sync lifecycle -----------------------------------------------------------

// Makes no writes to any calendar. Returns its failure instead of throwing,
// because the error can name a calendar and a thrown one reaches the owner's logs.
// `token` names this run's progress. See getSyncProgress().
function previewSync(token) {
  try {
    var settings = loadSettings();
    assertReadyToSync(settings);
    var built = buildSyncPlan(Date.now(), progressReporter(token));
    // Read again, because a preview can take minutes.
    var latest = loadStoredSettings();
    latest.previewed = true;
    // Sync now may carry out as many deletes as this preview just showed.
    latest.approvedDeletes = built.plan.deletes.length;
    saveStoredSettings(latest);
    return { preview: summarizePlan(built.plan, built.excluded) };
  } catch (e) {
    return { error: describeRunError(e) };
  }
}

function syncNow(token) {
  var settings = loadSettings();
  assertReadyToSync(settings);
  assertPreviewed(settings);
  try {
    var status = runSync(settings.approvedDeletes, progressReporter(token));
    return status ? { status: status } : { status: loadStatus(), busy: true };
  } catch (e) {
    // runSync() has already recorded it, and the page shows the status.
    return { status: loadStatus() };
  }
}

// --- Progress -----------------------------------------------------------------

var PROGRESS_CACHE_PREFIX = 'progress:';
// Longer than any execution can run.
var PROGRESS_EXPIRY_SECONDS = 10 * 60;

// The page makes up a token for each Preview or Sync now, then polls this with it
// while the call runs. Skips loadSettings(), which would cost a Calendar API call
// on every poll. Returns null until the run has reported anything.
function getSyncProgress(token) {
  if (!isValidProgressToken(token)) {
    return null;
  }
  var json = CacheService.getUserCache().get(PROGRESS_CACHE_PREFIX + token);
  return json ? JSON.parse(json) : null;
}

// A run reports nothing without a valid token, so the trigger writes nothing.
function progressReporter(token) {
  if (!isValidProgressToken(token)) {
    return noProgress;
  }
  var cache = CacheService.getUserCache();
  return makeProgressReporter(function (json) {
    cache.put(PROGRESS_CACHE_PREFIX + token, json, PROGRESS_EXPIRY_SECONDS);
  }, Date.now);
}

// Pure.
function isValidProgressToken(token) {
  return typeof token === 'string' && /^[a-z0-9]{1,40}$/.test(token);
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
  } else if (frequency === 'every30m') {
    builder.everyMinutes(30);
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
