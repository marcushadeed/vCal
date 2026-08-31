# Apps Script Constraints & Implementation Notes

## Language & Runtime
- **No ES6 modules**. No `import`, `export`, or `require()`. Every `.gs` file is concatenated into one global namespace.
- **V8 runtime only**. Apps Script will use the V8 engine; legacy Rhino is not an option.
- **No external npm packages** at runtime. No test frameworks. Tests are a plain function `runTests()` executed manually in the editor.
- **Keep source files plain ASCII.** Control characters must be written with `String.fromCharCode()`, never embedded literally — a raw byte in a `.js` file survives neither editors nor `clasp push` reliably. `FIELD_SEPARATOR` in `sync.js` is the one place this comes up.

## Architecture

### Filter Logic
Rules are a **blacklist**, not a whitelist: every event is mirrored by default, and rules describe the events to *exclude*. The core filter is a **pure function** of the event's title and start time, returning `true` when the event matches an exclusion rule and should be filtered **out** of the mirror:

```javascript
function matchesRules(title, startTime) {
  // Pure: no side effects, no dependency on external state besides CONFIG.rules
  // Testable in isolation
  // Returns true when the event matches a blacklist rule (i.e. should be excluded)
}
```

This allows testing against sample titles and times without touching CalendarApp or running the full sync. An event is mirrored when `matchesRules()` returns `false`. The start time is a parameter (rather than read from an event object) specifically to keep the function pure — `days` and `time` rules need it.

### Reconciliation Strategy
Reconciliation is **incremental**. Each run computes the desired state, compares it against what the mirror already contains, and writes only the difference. A steady-state day typically writes **nothing at all**.

1. Build the complete desired event list in memory (source events not matching any blacklist rule).
2. Read the mirror's current contents in the window (`Calendar.Events.list`, paginated).
3. Diff the two by **sync key**, producing creates / updates / deletes / unchanged.
4. Apply: creates, then updates, then deletes.

Two pieces of metadata on every mirrored event make this work, both stored in private extended properties:

- **`gcalDiffSyncKey`** — stable identity of the source instance, `md5(sourceCalendarId, iCalUID, startTime)`. Decides *which* mirrored event corresponds to *which* source instance.
- **`gcalDiffSignature`** — hash of the event's content. Decides *whether* that mirrored event needs rewriting.

**The start time is mandatory in the sync key.** `CalendarEvent.getId()` returns the event's **iCalUID**, and every occurrence of a recurring series shares a single iCalUID (only the underlying API event ids are distinct). Keying on the UID alone would collapse all ~75 meetings of a recurring course onto one mirrored event.

A rescheduled source event gets a new sync key, so it shows up as a delete plus a create rather than an update. Slightly less efficient, but it keeps identity fully derivable from the source with no stored mapping to maintain.

Events in the mirror window **without** a sync key — created by hand, or by a pre-incremental version of this script — are treated as untracked and deleted. The mirror calendar is owned by the script.

### Change Detection
`computeSignature()` hashes **every readily available property of the source event**, in two layers:

1. **Every mirrored field** — title, location, description, start, end, all-day flag, colour, visibility. A change to any of these changes the hash, and the diff rewrites the copy.
2. **The source's `getLastUpdated()` timestamp**, as a catch-all. This covers edits to properties the script does not read at all, so a source event can never drift silently out of sync just because the changed field is not one of the ones enumerated above.

Layer 2 means an edit that does not actually affect the mirrored copy still costs one rewrite. That is the intended trade — correctness over saving a write, which incremental reconciliation has made cheap. Be aware that editing one occurrence of a recurring series can bump `lastUpdated` for every occurrence, producing a burst of rewrites on the following run. It is bounded, self-limiting (stable again on the run after), and covered by the runtime guard below.

### Runtime Guard
Apps Script kills an execution at **6 minutes**, for consumer *and* Google Workspace accounts alike. `applyPlan()` stops issuing writes at `MAX_RUNTIME_MS` (4.5 min) and logs how many changes were deferred.

This is safe precisely because reconciliation is incremental and recomputed from scratch every run: a partial run leaves the mirror in a valid intermediate state and the next run finishes the job. Creates and updates run **before** deletes so that running out of time leaves the mirror with extra stale events rather than missing ones.

The first run after a large config change (or the first run on an empty mirror) may take several passes to converge. Run `mirrorCalendarSync()` manually a few times to converge immediately rather than waiting for the daily trigger.

### Dry Run Mode
A module-level constant `DRY_RUN = true` at the top of `sync.js`. When true, log the plan and make **no writes**:
- A one-line summary: counts of creates, updates, deletes, unchanged, and rule-excluded.
- Intended **creates** with title, start time, and source calendar.
- Intended **updates** with title, start time, source, and what the mirrored copy currently says.
- Intended **deletes** with title, date, source, and why (no longer in source, vs. untracked).
- Intended **excludes** (source events filtered out by a blacklist rule) with title, start time, source, and the matching rule.

Default to `true`. Review the log, then set it to `false` and re-run after confirming the behavior is correct.

### Event Handling
The mirror calendar receives **copies** of source events, not links. Mirrored events are written through the **advanced Calendar service** (`Calendar.Events.insert` / `.update` / `.remove`), not `CalendarApp`, so that reminders and extended properties are set in the same call that creates the event — one write per event instead of three.

1. **Do NOT copy guest lists or attendees.** This will cause Google to send calendar invites to those people every day, forever. Copy title, time, location, description, colour, and visibility only.
2. **Explicitly set reminders to empty** — `reminders: { useDefault: false, overrides: [] }` in the event resource. If the source event has reminders and you copy them, the user gets double notifications for events they're already invited to.
3. **Recurring events become individual instances.** `getEvents()` returns expanded events, so a recurring meeting in the source becomes 100+ individual copies in the mirror. This is correct for the use case (filter by title, not structure), and is why the sync key must include the start time.
4. **All-day events use `date`, not `dateTime`.** Both `getAllDayEndDate()` and the API's `end.date` are exclusive (midnight at the start of the day *after* the event ends), in the script's time zone, so they map across directly.

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

## Testing

`runTests()` runs **without touching CalendarApp**, so it's fast and safe to run from the Apps Script editor. It covers three pure functions:

- `matchesRules()` — blacklist filtering, including day- and time-constrained rules.
- `computeSyncKey()` — stability, and crucially that a shared iCalUID at different start times yields **different** keys.
- `computeSignature()` — that a change to each mirrored field is detected, and that an edit to an unmirrored property is still caught via `lastUpdated`.

Anything added to `computeSignature()` needs a corresponding case in `testComputeSignature()`; a field that is hashed but untested will silently stop triggering updates if it is ever dropped.

## Scheduled Trigger

The entry point is `function mirrorCalendarSync()`. This function:
1. Loads config (will fail helpfully if CONFIG is not defined — user will see the error immediately)
2. Fetches events from all source calendars within the date window
3. Filters out events matching a blacklist rule; everything else passes through
4. Builds the desired state, reads the mirror's current state, and diffs them
5. If `DRY_RUN === true`, logs the plan and returns
6. If `DRY_RUN === false`, applies creates, updates, and deletes — stopping early if the run approaches the execution limit

Add a time-driven trigger only after manual testing confirms the output is correct. **Do not set the trigger in code** — the user will add it from the Apps Script UI after reviewing logs.

## Critical Gotchas

### 1. Guest Lists Cause Invite Spam
Copying the guest/attendee list from a source event to the mirror will cause Google Calendar to **send invitations every day**. The user will receive notifications for people who were invited to the original event, even if they have nothing to do with the mirror. Never include an `attendees` key in the event resource.

### 2. Reminders Double-Notify
If a user is invited to both the source event and the mirrored copy, they receive two notifications if reminders are copied. Always set `reminders: { useDefault: false, overrides: [] }` on every mirrored event, regardless of source reminder settings.

### 3. Recurring Occurrences Share One iCalUID
`CalendarEvent.getId()` returns the iCalUID, which is **identical across every occurrence** of a recurring series. Any identity scheme built on it alone will collapse a whole semester of a course onto a single event. The sync key includes the start time for exactly this reason — don't remove it.

### 4. Empty Rules List Mirrors Everything, Not Nothing
Rules are a blacklist, so an empty `rules: []` array excludes nothing — **every** event from **every** source calendar will be mirrored. This is the opposite of the old whitelist default (empty = mirror nothing). Always review dry-run output before setting `DRY_RUN = false`, especially on a config that hasn't had exclusion rules added yet.

### 5. The Mirror Calendar Is Owned By The Script
Events added to the mirror by hand have no sync key and will be deleted on the next run. Don't use the mirror calendar as a place to keep your own events.

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

`appsscript.json` enables the **advanced Calendar service** (`Calendar`, v3). The existing `.../auth/calendar` scope already covers it; no additional scope is needed. Re-authorization is required the first time the service is used.

## Debugging

Apps Script's built-in logging goes to the execution transcript. Use `Logger.log()` liberally. The user can view logs in Apps Script editor > Executions tab after each manual run.
