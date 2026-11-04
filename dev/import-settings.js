// Paste into the NEW project's editor, along with a temporary function that calls
// importSettings with the JSON from exportSettings(). Run it BEFORE the first
// deployment, then delete both and save, so the data never lands in a saved
// version. Task 8 of the shared link plan covers the steps.
//
// Everything is checked before anything is saved, so a bad value stops the import
// with an error and leaves nothing half done. This file holds no personal data, and
// dev/ is never pushed.

function importSettings(json) {
  var data = JSON.parse(json);
  var mirrorCalendarId = data.settings.mirrorCalendarId;
  var sources = validateSources(data.settings.sourceCalendars, mirrorCalendarId);
  var lookaheadDays = validateLookaheadDays(data.settings.lookaheadDays);
  assertReadyToSync({ mirrorCalendarId: mirrorCalendarId, sourceCalendars: sources });
  // Once saved, a mirror that fails this would stop the page from loading at all.
  assertSafeMirror(mirrorCalendarId, Calendar.Calendars.get('primary').id, sources);
  data.rules.forEach(function (rule, index) {
    try {
      validateRule(rule);
    } catch (e) {
      throw new Error('Rule ' + (index + 1) + ' of ' + data.rules.length + ': ' + e.message);
    }
  });

  var settings = loadStoredSettings();
  settings.mirrorCalendarId = mirrorCalendarId;
  settings.sourceCalendars = sources;
  settings.lookaheadDays = lookaheadDays;
  settings.previewed = false;
  settings.enabled = false;
  saveStoredSettings(settings);
  data.rules.forEach(addRule);

  Logger.log('Imported settings and ' + data.rules.length + ' item(s).');
}
