// Per-user settings and run status, in User Properties. Nothing here is shared
// between users, and nothing personal ever goes in the code.
//
// CONFIG always exists, with empty defaults. loadSettings() fills it at the start
// of every entry point, so the rest of the script reads it as one plain object.

var CONFIG = {
  mirrorCalendarId: '',
  sourceCalendars: [],
  rules: [],
  lookaheadDays: 180,
  timeZone: '',
};

// Hours between scheduled runs, for each frequency the page offers.
var FREQUENCY_HOURS = { daily: 24, every6h: 6, hourly: 1 };

var SETTINGS_KEY = 'settings';
var STATUS_KEY = 'status';

// --- Pure ---------------------------------------------------------------------
//
// Errors can reach the owner's logs, so none of these repeat a calendar's id or
// name.

// The sync deletes everything in the mirror that it didn't create, so the mirror
// must never be a calendar with real events in it. An empty id means no mirror
// has been set yet, which assertReadyToSync() deals with.
function assertSafeMirror(mirrorCalendarId, primaryCalendarId, sourceCalendars) {
  if (mirrorCalendarId === 'primary' || (mirrorCalendarId && mirrorCalendarId === primaryCalendarId)) {
    throw new Error('Your main calendar cannot be the mirror, because vCal deletes events it did not create.');
  }
  var isSource = sourceCalendars.some(function (source) {
    return source.id === mirrorCalendarId;
  });
  if (isSource) {
    throw new Error('The mirror calendar cannot also be a source calendar.');
  }
}

// No sources would give an empty desired state, and the diff would then delete
// the whole mirror.
function assertReadyToSync(settings) {
  if (!settings.mirrorCalendarId) {
    throw new Error('Create a mirror calendar first.');
  }
  if (settings.sourceCalendars.length === 0) {
    throw new Error('Choose at least one source calendar first.');
  }
}

// A run can fail before any of our code does, for example when link sharing is
// turned off, and then nothing gets recorded. So the page warns when the last
// recorded run is too old, counting from when sync was last turned on if that's
// later. One missed run is normal, hence the factor of two.
function isRunStale(settings, status, nowMs) {
  if (!settings.enabled) {
    return false;
  }
  var lastRunMs = status && status.lastRunAt ? new Date(status.lastRunAt).getTime() : 0;
  var enabledMs = settings.enabledAt ? new Date(settings.enabledAt).getTime() : 0;
  var since = Math.max(lastRunMs, enabledMs);
  if (since === 0) {
    return false;
  }
  var allowedHours = 2 * FREQUENCY_HOURS[settings.frequency] + 1;
  return nowMs - since > allowedHours * 60 * 60 * 1000;
}

function validateLookaheadDays(days) {
  var number = typeof days === 'string' || typeof days === 'number' ? Number(days) : NaN;
  if (Math.floor(number) !== number || number < 1 || number > 365) {
    throw new Error('Enter a whole number of days from 1 to 365.');
  }
  return number;
}

// Returns cleaned { id, name, color? } entries.
function validateSources(sources, mirrorCalendarId) {
  if (!Array.isArray(sources)) {
    throw new Error('Choose your source calendars again.');
  }
  return sources.map(function (source) {
    if (!source || typeof source.id !== 'string' || source.id === '') {
      throw new Error('A source calendar is missing its id.');
    }
    if (source.id === mirrorCalendarId) {
      throw new Error('The mirror calendar cannot also be a source calendar.');
    }
    var name = typeof source.name === 'string' ? source.name.trim() : '';
    var cleaned = { id: source.id, name: name || 'Calendar' };
    var color = source.color;
    if (color !== undefined && color !== null && color !== '') {
      if (!isValidEventColorId(color)) {
        throw new Error('Choose a colour from the list.');
      }
      cleaned.color = String(color);
    }
    return cleaned;
  });
}

// --- User Properties ----------------------------------------------------------

function loadStoredSettings() {
  var defaults = {
    mirrorCalendarId: '',
    sourceCalendars: [],
    lookaheadDays: 180,
    previewed: false,
    enabled: false,
    enabledAt: '',
    frequency: 'daily',
  };
  var json = PropertiesService.getUserProperties().getProperty(SETTINGS_KEY);
  if (!json) {
    return defaults;
  }
  var stored;
  try {
    stored = JSON.parse(json);
  } catch (e) {
    // A parse error can quote the JSON, which holds calendar ids.
    throw new Error('Your stored settings could not be read.');
  }
  Object.keys(stored).forEach(function (key) {
    defaults[key] = stored[key];
  });
  return defaults;
}

function saveStoredSettings(settings) {
  PropertiesService.getUserProperties().setProperty(SETTINGS_KEY, JSON.stringify(settings));
}

// Returns null before the first run.
function loadStatus() {
  var json = PropertiesService.getUserProperties().getProperty(STATUS_KEY);
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function recordStatus(status) {
  PropertiesService.getUserProperties().setProperty(STATUS_KEY, JSON.stringify(status));
}

// Fills CONFIG for this execution and returns the stored settings.
function loadSettings() {
  var stored = loadStoredSettings();
  // The time zone and the safety check share this one call.
  var primary = Calendar.Calendars.get('primary');
  assertSafeMirror(stored.mirrorCalendarId, primary.id, stored.sourceCalendars);
  CONFIG.mirrorCalendarId = stored.mirrorCalendarId;
  CONFIG.sourceCalendars = stored.sourceCalendars;
  CONFIG.lookaheadDays = stored.lookaheadDays;
  CONFIG.timeZone = primary.timeZone;
  CONFIG.rules = loadRules();
  return stored;
}
