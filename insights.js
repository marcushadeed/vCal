// Time per source calendar, for the page (issue #4). Google's Time Insights reads
// only the primary calendar, and counts only accepted meetings with other guests,
// so it can never see the mirror. This shows the same kind of breakdown for the
// events vCal mirrors instead.
//
// It reads source calendars and writes nothing. Its result holds calendar names,
// so it goes only to the page, never to a log.

// Hours per source for `period`: 'thisWeek', 'lastWeek', 'thisMonth' or
// 'lastMonth'. Like the page's event list,
// a calendar that can't be read gives a warning, because nothing here can delete.
function getTimeInsights(period) {
  loadSettings();
  var today = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd');
  var range = periodRange(period, today, readWeekStart(), CONFIG.timeZone);
  var warnings = [];
  var sources = CONFIG.sourceCalendars.map(function (source) {
    var intervals = [];
    try {
      listSourceEvents(source.id, new Date(range.startMs), new Date(range.endMs)).forEach(function (item) {
        var interval = timedInterval(item, CONFIG.timeZone);
        if (interval) intervals.push(interval);
      });
    } catch (e) {
      warnings.push(describeRunError(tagSourceError(e, source.name)));
    }
    return { name: source.name, color: source.color || '', intervals: intervals };
  });
  var summary = summarizeTime(sources, range.startMs, range.endMs);
  summary.firstDay = range.startDate;
  summary.lastDay = addDays(range.endDate, -1);
  summary.warnings = warnings;
  return summary;
}

// 0 is Sunday, 1 Monday and 6 Saturday, from the user's Calendar settings.
// Sunday if the setting can't be read, since it only moves the week's first day.
function readWeekStart() {
  try {
    var value = parseInt(Calendar.Settings.get('weekStart').value, 10);
    return value >= 0 && value <= 6 ? value : 0;
  } catch (e) {
    return 0;
  }
}

// --- Pure ---------------------------------------------------------------------

// The period's first day and the day after its last, as YYYY-MM-DD, and both as
// the instant of local midnight in `timeZone`. `today` is YYYY-MM-DD in that zone.
function periodRange(period, today, weekStart, timeZone) {
  var startDate;
  var endDate;
  if (period === 'thisWeek' || period === 'lastWeek') {
    var sinceWeekStart = (DAY_CODES.indexOf(dayCodeOf(today)) - weekStart + 7) % 7;
    startDate = addDays(today, -sinceWeekStart - (period === 'lastWeek' ? 7 : 0));
    endDate = addDays(startDate, 7);
  } else if (period === 'thisMonth' || period === 'lastMonth') {
    var pieces = today.split('-').map(Number);
    var month = pieces[1] - 1 - (period === 'lastMonth' ? 1 : 0);
    startDate = utcDateString(Date.UTC(pieces[0], month, 1));
    endDate = utcDateString(Date.UTC(pieces[0], month + 1, 1));
  } else {
    throw new Error('Choose a period.');
  }
  return {
    startDate: startDate,
    endDate: endDate,
    startMs: localMidnightMs(startDate, timeZone),
    endMs: localMidnightMs(endDate, timeZone),
  };
}

function addDays(date, days) {
  var pieces = date.split('-').map(Number);
  return utcDateString(Date.UTC(pieces[0], pieces[1] - 1, pieces[2] + days));
}

function utcDateString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// The instant `date` begins in `timeZone`. Guesses from the offset at UTC
// midnight, then corrects with the offset at the guess, which differs only when
// daylight saving changes in between.
function localMidnightMs(date, timeZone) {
  var pieces = date.split('-').map(Number);
  var target = Date.UTC(pieces[0], pieces[1] - 1, pieces[2]);
  var guess = target;
  for (var i = 0; i < 2; i++) {
    guess = target - zoneOffsetMs(guess, timeZone);
  }
  return guess;
}

// How far `timeZone`'s clock is ahead of UTC at `ms`, which is a whole minute.
function zoneOffsetMs(ms, timeZone) {
  var f = Utilities.formatDate(new Date(ms), timeZone, 'yyyy-MM-dd HH:mm');
  var local = Date.UTC(
    Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)),
    Number(f.slice(11, 13)), Number(f.slice(14, 16))
  );
  return local - ms;
}

// { startMs, endMs } for an event that counts toward time, otherwise null.
function timedInterval(item, timeZone) {
  if (!item.start || !item.start.dateTime || !item.end || !item.end.dateTime) {
    return null;
  }
  if (!countsTowardTime(item, localStartParts(item.start, timeZone))) {
    return null;
  }
  var startMs = new Date(item.start.dateTime).getTime();
  var endMs = new Date(item.end.dateTime).getTime();
  return endMs > startMs ? { startMs: startMs, endMs: endMs } : null;
}

// Counts the events the mirror holds, less all-day events, which would swamp the
// hours, and events the user declined.
function countsTowardTime(item, parts) {
  if (parts.allDay) {
    return false;
  }
  var declined = (item.attendees || []).some(function (attendee) {
    return attendee.self && attendee.responseStatus === 'declined';
  });
  return !declined && !matchesRules(item.summary || '', parts);
}

// Splits [startMs, endMs) so the parts add up to the whole: time in exactly one
// source goes to that source's row, time in two or more is `overlapMinutes`, and
// the rest is `freeMinutes`. Overlaps within one source count once.
function summarizeTime(sources, startMs, endMs) {
  var edges = [];
  sources.forEach(function (source, index) {
    source.intervals.forEach(function (interval) {
      var from = Math.max(interval.startMs, startMs);
      var to = Math.min(interval.endMs, endMs);
      if (to > from) {
        edges.push({ at: from, source: index, change: 1 });
        edges.push({ at: to, source: index, change: -1 });
      }
    });
  });
  edges.sort(function (a, b) {
    return a.at - b.at;
  });

  var open = sources.map(function () { return 0; });
  var sourceMs = sources.map(function () { return 0; });
  var overlapMs = 0;
  var previous = startMs;
  edges.forEach(function (edge) {
    var busy = [];
    open.forEach(function (count, index) {
      if (count > 0) busy.push(index);
    });
    if (busy.length === 1) {
      sourceMs[busy[0]] += edge.at - previous;
    } else if (busy.length > 1) {
      overlapMs += edge.at - previous;
    }
    open[edge.source] += edge.change;
    previous = edge.at;
  });

  var toMinutes = function (ms) { return Math.round(ms / 60000); };
  var rows = sources.map(function (source, index) {
    return { name: source.name, color: source.color, minutes: toMinutes(sourceMs[index]) };
  });
  var periodMinutes = toMinutes(endMs - startMs);
  var scheduled = rows.reduce(function (sum, row) { return sum + row.minutes; }, toMinutes(overlapMs));
  return {
    rows: rows,
    overlapMinutes: toMinutes(overlapMs),
    freeMinutes: Math.max(0, periodMinutes - scheduled),
    periodMinutes: periodMinutes,
  };
}
