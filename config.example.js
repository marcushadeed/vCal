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

    // Filter rules: a BLACKLIST. Every event from every source calendar is
    // mirrored UNLESS it matches at least one rule below — rules describe
    // events to EXCLUDE, not include. An empty array (the default) excludes
    // nothing, so everything gets mirrored.
    //
    // Each rule requires a title matcher (type + value) and can optionally add
    // day-of-week and/or time-of-day constraints, to exclude specific instances
    // out of a title that recurs multiple times a week (leaving the other
    // instances of that title to be mirrored as normal).
    //
    //   type:  'exact' (string equality) or 'regex' (RegExp.test)
    //   value: string (for 'exact') or RegExp (for 'regex')
    //   days:  optional array of day codes, any of
    //          ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].
    //          If present, only instances starting on one of these days are
    //          excluded by this rule.
    //   time:  optional { start: 'HH:MM', end: 'HH:MM' }, 24-hour format,
    //          evaluated against the event's start time. If present, only
    //          instances with a start time within [start, end) are excluded
    //          by this rule.
    //
    // A rule with no days/time excludes every instance of that title, on any
    // day at any time. An event is excluded from the mirror if it matches AT
    // LEAST ONE rule.
    rules: [
        // { type: 'exact', value: 'Personal - Doctor Appointment' }, // never mirror any instance
        // { type: 'exact', value: 'Team Standup', time: { start: '09:00', end: '10:00' } }, // exclude only the 9-10am instances, mirror the rest
        // { type: 'exact', value: 'Team Standup', days: ['MO', 'WE', 'FR'] }, // exclude only Mon/Wed/Fri instances, mirror the rest
        // { type: 'exact', value: 'Sprint Planning', days: ['TU'], time: { start: '14:00', end: '15:30' } }, // exclude only the Tuesday 2-3:30pm instance
        // { type: 'regex', value: /confidential/i },
    ],

    // Set lookahead window to avoid fetching infinitely recurring events.
    lookaheadDays: 180, // Include events up to N days in future
};
