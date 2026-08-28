// Copy this to config.js and fill in your actual values
// config.js is .gitignored and not tracked in version control

const CONFIG = {
    // Calendar ID of the mirror calendar where filtered events will be created
    // Find this in Google Calendar Settings > Integrate calendar > Calendar ID
    mirrorCalendarId: 'YOUR_MIRROR_CALENDAR_ID@group.calendar.google.com',

    // Source calendars to filter from
    // Each entry is { id, name } where id comes from the source calendar's settings
    sourceCalendars: [
        // { id: 'SOURCE_CALENDAR_ID_1@group.calendar.google.com', name: 'Source Calendar 1' },
        // { id: 'SOURCE_CALENDAR_ID_2@group.calendar.google.com', name: 'Source Calendar 2' },
    ],

    // Filter rules: an event title must match at least one rule to be mirrored.
    // Each rule requires a title matcher (type + value) and can optionally add
    // day-of-week and/or time-of-day constraints, to select specific instances
    // out of a title that recurs multiple times a week.
    //
    //   type:  'exact' (string equality) or 'regex' (RegExp.test)
    //   value: string (for 'exact') or RegExp (for 'regex')
    //   days:  optional array of day codes, any of
    //          ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].
    //          If present, the event's start day must be one of these.
    //   time:  optional { start: 'HH:MM', end: 'HH:MM' }, 24-hour format,
    //          evaluated against the event's start time. If present, the
    //          start time must fall within [start, end).
    //
    // A rule with no days/time matches every instance of that title, on any
    // day at any time. An event is mirrored if it matches AT LEAST ONE rule.
    rules: [
        // { type: 'exact', value: 'All-Hands Meeting' }, // every instance, any day/time
        // { type: 'exact', value: 'Team Standup', time: { start: '09:00', end: '10:00' } }, // only 9-10am instances, any day
        // { type: 'exact', value: 'Team Standup', days: ['MO', 'WE', 'FR'] }, // only Mon/Wed/Fri instances, any time
        // { type: 'exact', value: 'Sprint Planning', days: ['TU'], time: { start: '14:00', end: '15:30' } }, // only the Tuesday 2-3:30pm instance
        // { type: 'regex', value: /roadmap.*review/i },
    ],

    // Set lookahead window to avoid fetching infinitely recurring events.
    lookaheadDays: 180, // Include events up to N days in future
};
