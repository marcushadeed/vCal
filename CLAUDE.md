# Apps Script Constraints & Implementation Notes

## Language & Runtime
- **No ES6 modules**. No `import`, `export`, or `require()`. Every `.gs` file is concatenated into one global namespace.
- **V8 runtime only**. Apps Script will use the V8 engine; legacy Rhino is not an option.
- **No external npm packages** at runtime. No test frameworks. Tests are a plain function `runTests()` executed manually in the editor.

## Architecture

### Filter Logic
Rules are a **blacklist**, not a whitelist: every event is mirrored by default, and rules describe the events to *exclude*. The core filter must be a **pure function** that takes only a title string and returns a boolean — `true` means the title matches an exclusion rule and should be filtered **out** of the mirror:

```javascript
function matchesRules(title) {
  // Pure: no side effects, no dependency on external state besides config.json
  // Testable in isolation
  // Returns true when `title` matches a blacklist rule (i.e. should be excluded)
}
```

This allows testing against sample titles without touching CalendarApp or running the full sync. An event is mirrored when `matchesRules()` returns `false`.

### Dry Run Mode
Implement a module-level constant `DRY_RUN = true` at the top of the main script. When true:
- Log intended deletes with event title, date, and original calendar source
- Log intended excludes (source events filtered out by a blacklist rule) with title, start time, date, source, and the matching rule (title and time window if applicable).
- Log intended creates with title, start time, date, and which source it came from. These are events that did **not** match any blacklist rule.
- **Do not actually delete or create events**

Default to `true`. The user will review the log, then set it to `false` and re-run after confirming the behavior is correct.

### Event Handling
The mirror calendar receives **copies** of source events, not links. When creating mirrored events:

1. **Do NOT copy guest lists or attendees.** This will cause Google to send calendar invites to those people every day, forever. Copy only title, time, location, and description.
2. **Explicitly set reminders to empty** (`event.removeAllReminders()`). If the source event has reminders and you copy them, the user will get double notifications for events they're already invited to.
3. **Recurring events become individual instances.** `getEvents()` returns expanded events, so a recurring meeting in the source becomes 100+ individual copies in the mirror. This is correct for the use case (filter by title, not structure), but document it.

### Time-Based Filtering
When an event title has multiple instances per week, use time-based filters to exclude only the specific instance(s) you don't want mirrored, leaving the rest of that title's instances to pass through by default:

1. **Time rules in config.js** — Each title rule can have an optional `time` property specifying the excluded time window:
   ```javascript
   { type: 'exact', value: 'Team Standup', time: { start: '09:00', end: '10:00' } }
   { type: 'regex', value: /Roadmap/, time: { start: '14:00', end: '15:30' } }
   ```
2. **Time format** — 24-hour HH:MM format. Times are evaluated against the event's start time in the user's calendar timezone.
3. **Logic** — An event matches a blacklist rule (and is excluded) when its title matches AND (if `days`/`time` are specified) its start day/time falls within those constraints. An event that matches no rule is mirrored by default.
4. **Overlap handling** — If an event matches multiple exclusion rules, it is still excluded only once — exclusion is a boolean outcome, so no special de-duplication is needed.

### Reconciliation Strategy
**Wipe-and-rebuild is safe** given the constraints (500 events, daily run, ~5,000 write quota/day):
1. Build the **complete list of events to mirror** (those not matching any blacklist rule) in memory (do not write yet).
2. Only after the full list is built, delete all events in the mirror calendar within the rolling window.
3. Create all new events.

This protects against partial failures: if the script crashes mid-run, the mirror is stale until the next scheduled run, but it never has orphaned half-deletes.

**Do not attempt incremental reconciliation** unless the user later asks for hourly runs. The complexity multiplies and the quota savings don't justify it for daily frequency.

## Testing

Write a `runTests()` function that runs **without touching CalendarApp**, so it's fast and safe. The user can execute it from the Apps Script editor and iterate on rules before enabling the schedule trigger.`

## Scheduled Trigger

The entry point is `function mirrorCalendarSync()`. This function:
1. Loads config (will fail helpfully if CONFIG is not defined — user will see the error immediately)
2. Fetches events from all source calendars within the date window
3. Filters out events matching a blacklist rule; everything else passes through
4. If `DRY_RUN === true`, logs intended changes and returns
5. If `DRY_RUN === false`, deletes old events and creates new ones

Add a time-driven trigger only after manual testing confirms the output is correct. **Do not set the trigger in code** — the user will add it from the Apps Script UI after reviewing logs.

## Critical Gotchas

### 1. Guest Lists Cause Invite Spam
Copying the guest/attendee list from a source event to the mirror will cause Google Calendar to **send invitations every day**. The user will receive notifications for people who were invited to the original event, even if they have nothing to do with the mirror. Always copy title, time, location, description only. Strip attendees entirely.

### 2. Reminders Double-Notify
If a user is invited to both the source event and the mirrored copy, they receive two notifications if reminders are copied. Explicitly call `event.removeAllReminders()` on every created event in the mirror, regardless of source reminder settings.

### 3. Wipe-and-Rebuild Crashes Leave Gaps
The mirror is blank until the next scheduled run if the script crashes mid-delete. Document that partial failures are possible and expected behavior. Don't attempt to recover or roll back — the next run rebuilds from scratch.

### 4. Empty Rules List Mirrors Everything, Not Nothing
Rules are a blacklist, so an empty `rules: []` array excludes nothing — **every** event from **every** source calendar will be mirrored. This is the opposite of the old whitelist default (empty = mirror nothing). Always review dry-run output before setting `DRY_RUN = false`, especially on a config that hasn't had exclusion rules added yet.

## Configuration

`config.js` (created by user from `config.example.js`) contains:
- `mirrorCalendarId`: Target calendar ID
- `sourceCalendars`: Array of `{ id, name }` objects
- `rules`: Array of **exclusion** (blacklist) rule objects. An event is mirrored **unless** it matches at least one rule. Each rule has:
  - `type`: `'exact'` (string match) or `'regex'` (pattern match)
  - `value`: String or RegExp to match against event title
  - `days` (optional): Array of day codes (`['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']`). If present, only instances starting on one of these days are excluded by this rule.
  - `time` (optional): Time window object with `start` and `end` in 24-hour format (HH:MM). If present, only events with start times within this window are excluded by this rule.
- `lookaheadDays`: Number of days to look ahead (default 180) to avoid fetching infinitely recurring events

This file is **not tracked in git** (it's in `.gitignore`), but **is pushed to Apps Script** (not in `.claspignore`). User secrets stay local; script logic is version-controlled.

## Debugging

Apps Script's built-in logging goes to the execution transcript. Use `Logger.log()` liberally. The user can view logs in Apps Script editor > Executions tab after each manual run.