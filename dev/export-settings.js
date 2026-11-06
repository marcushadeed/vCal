// Paste into the OLD project's editor and run exportSettings. Task 8 of the
// shared link plan covers when. Remove it from that project afterwards.
//
// Logs JSON to paste into importSettings() in the new project, with no quotes around
// it. The output holds personal calendar ids and rules, so don't save it in this
// repo. This file itself
// holds no personal data, and dev/ is never pushed.

function exportSettings() {
  var rules = CONFIG.rules.map(function (rule) {
    var exported = { type: rule.type, value: rule.value };
    if (rule.value instanceof RegExp) {
      exported.value = rule.value.source;
      // g and y make RegExp.test() keep state, and the new project refuses them.
      var flags = rule.value.flags.replace(/[gy]/g, '');
      if (flags) {
        exported.flags = flags;
      }
    }
    ['days', 'time', 'date'].forEach(function (limit) {
      if (rule[limit]) {
        exported[limit] = rule[limit];
      }
    });
    return exported;
  });

  var properties = PropertiesService.getScriptProperties().getProperties();
  Object.keys(properties).forEach(function (key) {
    if (key.indexOf('block:') === 0) {
      rules.push(JSON.parse(properties[key]));
    }
  });

  Logger.log(JSON.stringify({
    settings: {
      mirrorCalendarId: CONFIG.mirrorCalendarId,
      sourceCalendars: CONFIG.sourceCalendars,
      lookaheadDays: CONFIG.lookaheadDays,
    },
    rules: rules,
  }));
}
