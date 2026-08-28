# Apps Script Constraints & Implementation Notes

## Language & Runtime
- **No ES6 modules**. No `import`, `export`, or `require()`. Every `.gs` file is concatenated into one global namespace.
- **V8 runtime only**. Apps Script will use the V8 engine; legacy Rhino is not an option.
- **No external npm packages** at runtime. No test frameworks. Tests are a plain function `runTests()` executed manually in the editor.

## Architecture

### Filter Logic
The core filter must be a **pure function** that takes only a title string and returns a boolean:

```javascript
function matchesRules(title) {
  // Pure: no side effects, no dependency on external state besides config.json
  // Testable in isolation
}
```

This allows testing against sample titles without touching CalendarApp or running the full sync.

### Dry Run Mode
Implement a module-level constant `DRY_RUN = true` at the top of the main script. When true:
- Log intended deletes with event title, date, and original calendar source
- Log intended creates with title, date, time, and which source it came from
- **Do not actually delete or create events**

Default to `true`. The user will review the log, then set it to `false` and re-run after confirming the behavior is correct.

### Event Handling
The mirror calendar receives **copies** of source events, not links. When creating mirrored events:

1. **Do NOT copy guest lists or attendees.** This will cause Google to send calendar invites to those people every day, forever. Copy only title, time, location, and description.
2. **Explicitly set reminders to empty** (`event.removeAllReminders()`). If the source event has reminders and you copy them, the user will get double notifications for events they're already invited to.
3. **Recurring events become individual instances.** `getEvents()` returns expanded events, so a recurring meeting in the source becomes 100+ individual copies in the mirror. This is correct for the use case (filter by title, not structure), but document it.

### Reconciliation Strategy
**Wipe-and-rebuild is safe** given the constraints (500 events, daily run, ~5,000 write quota/day):
1. Build the **complete list of matching events** in memory (do not write yet).
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
3. Filters by rules
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

## Configuration

`config.js` (created by user from `config.example.js`) contains:
- `mirrorCalendarId`: Target calendar ID
- `sourceCalendars`: Array of `{ id, name }` objects
- `rules`: Array of `{ type: 'exact' | 'regex', value: string | RegExp }`

This file is **not tracked in git** (it's in `.gitignore`), but **is pushed to Apps Script** (not in `.claspignore`). User secrets stay local; script logic is version-controlled.

## Debugging

Apps Script's built-in logging goes to the execution transcript. Use `Logger.log()` liberally. The user can view logs in Apps Script editor > Executions tab after each manual run.