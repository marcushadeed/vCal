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

    // Filter rules: an event title must match at least one rule to be mirrored
    // Rules can be exact strings or regex patterns
    rules: [
        // { type: 'exact', value: 'Team Standup' },
        // { type: 'regex', value: /^sprint planning/i },
        // { type: 'regex', value: /roadmap.*review/ },
    ],

    // Set lookahead window to avoid fetching infinitely recurring events.
    lookaheadDays: 180, // Include events up to N days in future
};
