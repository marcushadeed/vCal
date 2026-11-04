// Server side of the blocking page (index.html). Deployed as a web app that
// runs as the owner and is restricted to the owner; see the README.

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('vCal blocks')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Everything the page shows. Dates are sent as strings, and times are formatted
// here rather than in the browser, so they use the script time zone that rules
// are evaluated in.
function getPageData() {
  pruneExpiredBlocks();
  var blocks = loadBlocks();
  var pageRules = blocks.map(function (block) {
    return block.rule;
  });

  var windowStart = new Date();
  var windowEnd = new Date(windowStart.getTime() + CONFIG.lookaheadDays * 24 * 60 * 60 * 1000);

  var events = [];
  var warnings = [];
  CONFIG.sourceCalendars.forEach(function (source) {
    try {
      listSourceEvents(source.id, windowStart, windowEnd).forEach(function (item) {
        events.push(toPageEvent(item, source.name, pageRules));
      });
    } catch (e) {
      // Matches how the sync skips a missing calendar: the rest still load.
      warnings.push('Could not read source calendar "' + source.name + '": ' + e.message);
    }
  });
  events.sort(function (a, b) {
    return a.startMs - b.startMs;
  });

  return {
    blocks: blocks
      .map(function (block) {
        return { key: block.key, description: describeBlock(block.rule) };
      })
      .sort(function (a, b) {
        return a.description < b.description ? -1 : 1;
      }),
    events: events,
    warnings: warnings,
  };
}

function toPageEvent(item, sourceName, pageRules) {
  var title = item.summary || '';
  var startTime = parseEventStart(item.start);
  var allDay = Boolean(item.start.date);
  return {
    title: title,
    start: item.start.date || item.start.dateTime,
    startMs: startTime.getTime(),
    allDay: allDay,
    day: formatDate(startTime),
    time: allDay ? '' : formatMinutes(startTime.getHours() * 60 + startTime.getMinutes()),
    sourceName: sourceName,
    blockedBy: classifyEvent(title, startTime, pageRules),
  };
}

// Returns 'config', 'page' or null. Config wins when both match, because the
// page's undo couldn't bring back an event that config.js also excludes.
function classifyEvent(title, startTime, pageRules) {
  if (findMatchingRule(title, startTime)) {
    return 'config';
  }
  var blocked = pageRules.some(function (rule) {
    return ruleMatches(rule, title, startTime);
  });
  return blocked ? 'page' : null;
}

function blockEvent(scope, title, start, allDay) {
  var startTime = parseEventStart(allDay ? { date: start } : { dateTime: start });
  addBlock(buildBlockRule(scope, title, startTime));
}

function unblock(key) {
  removeBlock(key);
}
