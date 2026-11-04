// Paste into the NEW project's editor, along with a temporary function that calls
// importSettings with the output of exportSettings() pasted straight in:
//
//   function runImport() {
//     importSettings(PASTE_THE_OUTPUT_HERE);
//   }
//
// Paste it with no quotes around it. JSON is valid JavaScript, so it stays exact.
// Inside a string, escapes like \\b in a regex would be changed with no error.
//
// Run it BEFORE the first deployment, then delete both and save, so the data never
// lands in a saved version. Task 8 of the shared link plan covers the steps.
//
// Everything is checked before anything is saved, so a bad value stops the import
// with an error and leaves nothing half done. This file holds no personal data, and
// dev/ is never pushed.

function importSettings(data) {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Paste the exported text with no quotes around it. See the comment above.');
  }
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
