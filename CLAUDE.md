# Apps Script Constraints & Implementation Notes

## Language & Runtime
- **No ES6 modules**. No `import`, `export`, or `require()`. Every `.gs` file is concatenated into one global namespace.
- **V8 runtime only**. Apps Script will use the V8 engine; legacy Rhino is not an option.
- **No external npm packages** at runtime. No test frameworks. Tests are a plain function `runTests()`, run with `TZ=America/New_York node dev/run-tests.js` or in the editor.
- **`dev/` may use Node APIs**, for the local test runner and the migration snippets. `.claspignore` keeps it out of Apps Script, and nothing outside it may depend on it.
- **Keep source files plain ASCII.** Control characters must be written with `String.fromCharCode()`, never embedded literally — a raw byte in a `.js` file survives neither editors nor `clasp push` reliably. `FIELD_SEPARATOR` in `sync.js` is the one place this comes up.

## Architecture

### Filter Logic
Rules are a **blacklist**, not a whitelist: every event is mirrored by default, and rules describe the events to *exclude*. The core filter is a **pure function** of the event's title and local start parts, returning `true` when the event matches an exclusion rule and should be filtered **out** of the mirror:

```javascript
function matchesRules(title, parts) {
  // parts: { date: 'YYYY-MM-DD', day: 'MO', minutes: Number, allDay: Boolean }, from localStartParts()
  // Pure: no side effects, no dependency on external state besides CONFIG.rules
  // Testable in isolation
  // Returns true when the event matches a blacklist rule (i.e. should be excluded)
}
```

This allows testing against sample titles and times without touching the Calendar API or running the full sync. An event is mirrored when `matchesRules()` returns `false`. Rule types are `exact` (trimmed), `contains` (trimmed and case-insensitive) and `regex`.

### Time Zones
Rule times follow each user's time zone, but a `Date`'s getters always use the script's. So rules never see a `Date`.

- `localStartParts(start, timeZone)` turns an API `start` into plain local parts. A `dateTime` is formatted once with `Utilities.formatDate()`. A `date` is used as is, with `minutes: 0`, and its weekday comes from `Date.UTC`, so no conversion can move it.
- The time zone comes from the user's primary calendar, read once per entry point by `loadSettings()`.
- **`computeSyncKey()` keeps using `parseEventStart()`.** The script's time zone is fixed, so all-day keys stay stable. Changing this would rebuild every mirror.

### Reconciliation Strategy
Reconciliation is **incremental**. Each run computes the desired state, compares it against what the mirror already contains, and writes only the difference. A steady-state day typically writes **nothing at all**.

1. Build the complete desired event list in memory (source events not matching any blacklist rule).
2. Read the mirror's current contents in the window (`Calendar.Events.list`, paginated).
3. Diff the two by **sync key**, producing creates / updates / deletes / unchanged.
4. Apply: creates, then updates, then deletes.

Two pieces of metadata on every mirrored event make this work, both stored in private extended properties:

- **`gcalDiffSyncKey`** — stable identity of the source instance, `md5(sourceCalendarId, iCalUID, startTime)`. Decides *which* mirrored event corresponds to *which* source instance.
- **`gcalDiffSignature`** — hash of the event's content. Decides *whether* that mirrored event needs rewriting.

**The start time is mandatory in the sync key.** The key uses the event's **`iCalUID`**, and every occurrence of a recurring series shares a single iCalUID (only the API event `id`s are distinct). Keying on the UID alone would collapse all ~75 meetings of a recurring course onto one mirrored event.

A rescheduled source event gets a new sync key, so it shows up as a delete plus a create rather than an update. Slightly less efficient, but it keeps identity fully derivable from the source with no stored mapping to maintain.

Events in the mirror window **without** a sync key — created by hand, or by a pre-incremental version of this script — are treated as untracked and deleted. The mirror calendar is owned by the script. Extra copies with the same sync key are deleted too, keeping the first.

### Reading Source Events
Source calendars are read with `listSourceEvents()` (`Calendar.Events.list`), which returns every event and its fields in one paginated call per calendar. **Don't read source events through `CalendarApp`.** Its per-event getters made about 8,000 calls per run, which pushed runs past the 6-minute limit before they reached the runtime guard (issue #7).

- **Normalise before hashing.** The API returns times with an offset, so `buildEventResource()` converts them to UTC. The same instant written another way would change every signature and rewrite the whole mirror.
- **An unreadable calendar fails the run.** Don't catch list errors in the sync. Skipping a calendar leaves its events out of the desired state, and the diff would then delete all of their mirrored copies, even on a temporary API error.

### Change Detection
`computeSignature()` hashes **every readily available property of the source event**, in two layers:

1. **Every mirrored field** — title, location, description, start, end, all-day flag, colour, visibility. A change to any of these changes the hash, and the diff rewrites the copy.
2. **The source item's `updated` timestamp**, as a catch-all. This covers edits to properties the script does not read at all, so a source event can never drift silently out of sync just because the changed field is not one of the ones enumerated above.

Layer 2 means an edit that does not actually affect the mirrored copy still costs one rewrite. That is the intended trade — correctness over saving a write, which incremental reconciliation has made cheap. Be aware that editing one occurrence of a recurring series can bump `lastUpdated` for every occurrence, producing a burst of rewrites on the following run. It is bounded, self-limiting (stable again on the run after), and covered by the runtime guard below.

### Runtime Guard
Apps Script kills an execution at **6 minutes**, for consumer *and* Google Workspace accounts alike. `applyPlan()` stops issuing writes at `MAX_RUNTIME_MS` (4.5 min) and logs how many changes were deferred.

This is safe precisely because reconciliation is incremental and recomputed from scratch every run: a partial run leaves the mirror in a valid intermediate state and the next run finishes the job. Creates and updates run **before** deletes so that running out of time leaves the mirror with extra stale events rather than missing ones.

The first run after a large change (or the first run on an empty mirror) may take several passes to converge. **Sync now** on the page runs one immediately rather than waiting for the trigger.

### Preview and Sync Lifecycle
`buildSyncPlan()` computes the plan for both **Preview** and a real sync, so they can't disagree.

- **Preview** (`previewSync()`) writes nothing to any calendar. It returns `summarizePlan()` to the page: counts, plus creates, updates, deletes and excludes, each with title, start, source and reason. It sets `previewed`.
- **Turn on sync** (`turnOnSync()`) requires `previewed`. It replaces any existing trigger, and creates one for the chosen frequency.
- **Pause** (`pauseSync()`) deletes the trigger and clears `enabled`.
- **Sync now** (`syncNow()`) requires `previewed`, and works while paused.
- `mirrorCalendarSync()` returns immediately when `enabled` is unset, so a leftover trigger can't write anything.
- `runSync()` holds `LockService.getUserLock()`, because **Sync now** can overlap a scheduled run. A run that can't get the lock returns `null` without error.
- Every run records its result in the `status` property. Failures are recorded, then rethrown.
- `assertReadyToSync()` refuses to preview or sync with no mirror or no sources. **No sources would give an empty desired state, and the diff would delete the whole mirror.**
- **A run stops before a mass delete.** A preview is only required once, but a later rule like `.+` can still empty the mirror. `isMassDelete()` is more than half of the mirror and at least `MASS_DELETE_MINIMUM` (10) events. `shouldStopForDeletes()` then stops the run unless a preview showed at least that many deletes. Only **Sync now** passes that approval (`approvedDeletes`), so a scheduled run never carries out a mass delete, and a finished sync clears it. Don't make a scheduled run honour it: viewing a preview isn't agreeing to it.
- **The page blocks itself while working** (issue #10). `#content` is disabled at once, and a modal `<dialog>` opens after 250 ms so quick saves don't flash it. Escape can't close it.
- **Preview and Sync now report progress.** The page makes up a token, passes it to `previewSync(token)` / `syncNow(token)`, and polls `getSyncProgress(token)` while the call runs. The run writes `{ phase, done, total }` to `CacheService.getUserCache()` through `makeProgressReporter()`: `read` per calendar, `mirror`, then `write`, throttled to once a second except its first and last count. Counts only. Without a valid token (`isValidProgressToken()`) nothing is written, so a scheduled run reports nothing. `getSyncProgress()` skips `loadSettings()`, which would cost a Calendar API call per poll.
- `isRunStale()` drives the page's overdue warning. Turning off link sharing makes triggers fail before our code runs, so nothing can be recorded and stored errors aren't enough.

### Event Handling
The mirror calendar receives **copies** of source events, not links. Mirrored events are written through the **advanced Calendar service** (`Calendar.Events.insert` / `.update` / `.remove`), not `CalendarApp`, so that reminders and extended properties are set in the same call that creates the event — one write per event instead of three.

1. **Do NOT copy guest lists or attendees.** This will cause Google to send calendar invites to those people every day, forever. Copy title, time, location, description, colour, and visibility only.
2. **Explicitly set reminders to empty** — `reminders: { useDefault: false, overrides: [] }` in the event resource. If the source event has reminders and you copy them, the user gets double notifications for events they're already invited to.
3. **Recurring events become individual instances.** `singleEvents: true` returns expanded events, so a recurring meeting in the source becomes 100+ individual copies in the mirror. This is correct for the use case (filter by title, not structure), and is why the sync key must include the start time.
4. **All-day events use `date`, not `dateTime`.** The API's `end.date` is exclusive (the day *after* the event ends), so it is copied across directly.
5. **Colour identifies the source calendar.** `resolveColorId()` decides the mirrored event's `colorId`: the source event's own colour override wins when it has one, otherwise the event takes its source calendar's configured `color`, otherwise the field is left unset and the event inherits the mirror calendar's default. It must be resolved *inside* `buildEventResource()`, i.e. before `computeSignature()` runs on the finished resource — setting the colour afterwards would make a colour change invisible to the diff. Note that Google's per-event colours are ids `'1'`-`'11'`, a different set from the 24 calendar colours.

### Time-Based Filtering
When an event title has multiple instances per week, use time-based filters to exclude only the specific instance(s) you don't want mirrored, leaving the rest of that title's instances to pass through by default:

1. **Time limits on rules** — Rules come from the page's form. Each can have an optional `time` property specifying the excluded time window. Stored rules are plain JSON, so a regex is text, and `loadRules()` compiles it for `CONFIG.rules`:
   ```javascript
   { type: 'exact', value: 'Team Standup', time: { start: '09:00', end: '10:00' } }
   { type: 'regex', value: 'Roadmap', flags: 'i', time: { start: '14:00', end: '15:30' } }
   ```
2. **Time format** — Stored as 24-hour HH:MM, from `00:00` to `24:00`. Times are evaluated against the event's start time in the user's calendar timezone. The page shows 12-hour times (`formatTime12()`) and picks them with hour, minute and AM/PM selects (issue #15). A To time of 12:00 AM is stored as `24:00`.
3. **Logic** — An event matches a blacklist rule (and is excluded) when its title matches AND (if `days`/`time`/`date` are specified) its start day/time/date falls within those constraints. An event that matches no rule is mirrored by default.
4. **Overlap handling** — If an event matches multiple exclusion rules, it is still excluded only once — exclusion is a boolean outcome, so no special de-duplication is needed.

### Rule Store
`blocks.js` is the rule store. Rules from the page's form and from its **Block this** and **Block all titled this** buttons are one list, in User Properties, per user. `loadSettings()` compiles them into `CONFIG.rules` at the start of every entry point, so `matchesRules()` needs no second code path, and the existing diff deletes newly excluded copies and recreates ones no longer excluded.

1. **One property per rule**, keyed `rule:<md5 of the normalized rule JSON>`. This avoids the 9KB-per-value limit and means two saves can't overwrite each other. Don't move them into a single shared value.
2. **`validateRule()` runs before storing and when loading.** It checks for a known type, a non-empty value, a compilable regex, valid day codes, `HH:MM` times with start before end, and real dates with start not after end. Its errors never repeat the value.
3. **An "Any title" rule (regex `.*`) with no limit is refused**, because it would empty the mirror at the next sync.
4. **`flags` is only ever `''` or `'i'`.** `g` and `y` make `RegExp.test()` keep state between calls, which would skip matches.
5. **Two kinds of block.** **Block all titled this** is an exact title rule, and is refused on an empty title, because it would block every untitled event. **Block this** adds that event's date and a one-minute `time` window. Rules match on title and start time, so a rule applies across all source calendars, and renaming an event or moving an occurrence breaks its block.
6. **Editing writes the new rule, then deletes the old one**, since keys are content hashes. An edit that changes nothing gives the same key, which `replaceRule()` must not delete.
7. **All-day starts must go through `localStartParts()` or `parseEventStart()`.** `new Date('2026-12-25')` is UTC midnight, which is Dec 24 in New York.
8. **The page reads events with `listSourceEvents()`**, the same as the sync. Unlike the sync, it catches a failed calendar and shows a warning, because a page load can't delete anything.
9. **Event text is inserted with `textContent`, never `innerHTML`.** Anyone who can edit a shared calendar controls it.
10. **An unreadable stored rule is deleted when rules load**, with only a count logged, and the page shows a notice until it's dismissed. Users have no editor to repair one, and the worst outcome is that its events return to the mirror. **So tightening `validateRule()` deletes matching rules for every user at their next load.** `STORED_RULE_FIXTURES` in `tests.js` pins what must keep validating. Only ever add to it.
11. **Rules outlive their date range by 30 days** (`RULE_EXPIRY_GRACE_DAYS`), then are deleted on page load, using the user's time zone. Rules match on start date, but the sync reads events still running, so removing a rule once its date passes would bring back a multi-day event it excluded.
12. **The page always receives the stored form**, because a `RegExp` can't pass through `google.script.run`.

### Calendars
**Create mirror calendar** is the only way to set a mirror on the page, because the sync deletes everything in the mirror without a sync key. Users can't point it at an existing calendar. Users name it when creating it (`validateMirrorName()`, default `vCal mirror`), and **Rename** patches the calendar's own `summary`, not the per-user `summaryOverride`, so people it's shared with see the new name. `loadSettings()` refuses a mirror that is the primary calendar or is also a source. Sources come from a picker backed by `Calendar.CalendarList.list`, which leaves out the mirror but keeps any stored source that is no longer listed, so it can be removed.

## Testing

`npm test`, or `TZ=America/New_York node dev/run-tests.js`, runs `runTests()` locally. It needs only Node, and it also compiles the page's inline script. Run it in a second time zone too, such as `TZ=Asia/Tokyo`, when changing anything about dates or times. The runner has stubs only for `Logger`, `console` and `Utilities`, so a test that touches `PropertiesService`, `Calendar`, `ScriptApp`, `LockService` or `CalendarApp` fails with a `ReferenceError`. It never loads `config.js`.

`runTests()` runs **without touching the Calendar API or User Properties**, so it's fast and safe to run from the Apps Script editor too. It covers these pure functions:

- `matchesRules()` and `ruleMatches()` — blacklist filtering, including `contains` and day-, time- and date-constrained rules.
- `localStartParts()`, `describeStart()` and `formatTime12()` — time zones, daylight saving, all-day events, and a block made near midnight matching only its own event.
- `validateRule()`, `normalizeRule()`, `compileRule()`, `parseStoredRule()` and `describeRule()` — what's accepted and refused, that errors don't repeat the rule, and regex rules surviving JSON.
- `resolveColorId()` — the event override / source-calendar colour precedence, and that out-of-range or non-string colour ids are ignored.
- `buildEventResource()` — timed and all-day items, missing fields, that attendees are never copied and reminders are cleared, and that an offset timestamp hashes the same as its UTC form.
- `computeSyncKey()` — stability, and crucially that a shared iCalUID at different start times yields **different** keys. `testIdentityIsPinned()` fixes a timed key, an all-day key and a signature to the values existing mirrors use. If one changes, every mirrored event is rebuilt.
- `computeSignature()` — that a change to each mirrored field is detected, and that an edit to an unmirrored property is still caught via `lastUpdated`.
- `buildBlockRule()` — that an occurrence block matches only that occurrence, a title block matches every instance, and an empty title is refused. Rules are round-tripped through JSON first, as the store does.
- `assertSafeMirror()`, `assertReadyToSync()`, `isMirrorMissing()`, `validateLookaheadDays()`, `validateSources()`, `validateMirrorName()` and `findMirrorName()` — the settings safety checks.
- `isRunStale()`, `summarizePlan()`, `finishRun()`, `describeRunError()` and `tagSourceError()` — the lifecycle's pure logic, including that a rethrown error's message holds no calendar name.
- `makeProgressReporter()` and `isValidProgressToken()` — which progress gets written, and that it holds counts only.
- `isMassDelete()`, `shouldStopForDeletes()` and `describeMassDelete()` — the mass delete limits, and that the message holds counts only.
- `addMirrorItem()` and `buildPlan()` — that a duplicate is deleted and its first copy kept.
- `parseEventStart()`, `isBlockExpired()`, `describeRemovedRules()` and `comparePageEvents()` — the rest of the store's and page's pure logic.

Anything added to `computeSignature()` needs a corresponding case in `testComputeSignature()`; a field that is hashed but untested will silently stop triggering updates if it is ever dropped.

`npm test` runs it in both New York and Tokyo.

The DOM has no automated tests. Behaviour on the page and against live Google services is checked by hand, using the steps in `docs/superpowers/specs/2026-11-04-shared-link-design.md`, **in the testing project, never in prod**.

### Testing Project
There are two Apps Script projects. `.clasp.json` is **prod**, the shared project users run. `.clasp-testing.json` is **vCal-testing**, private, used for every live check. Both are gitignored.

Users only get code when prod is deployed, so a push to prod doesn't break them. The testing project exists anyway so that prod's latest push is always releasable, since a new version takes whatever was pushed last, and because viewers can read prod's latest push.

- **Push with `npm run push:testing`**, which runs the tests and then `clasp -P "$PWD/.clasp-testing.json" push --force`. `-P` needs an absolute path, or clasp fails with "escapes project root".
- **A bare `clasp push` goes to prod.** Only run `npm run push:prod` when the user asks. Never run `clasp deploy` or redeploy against prod unless the user asks, because a deployment reaches every user's next run.
- **Don't test with a test deployment of the prod project.** It shares that account's User Properties, trigger and mirror with the real one.
- The testing project runs under the owner's own account, with its own settings, rules and mirror, since User Properties and triggers are per project. The owner is fine with it using their real calendars as sources. It must never use the real mirror as a source.
- **Don't reuse the old private project** (`.clasp.json.old`). It held `config.js`.

## Scheduled Trigger

The trigger's entry point is `function mirrorCalendarSync()`. **The page creates and deletes each user's trigger**, through **Turn on sync** and **Pause**. `getProjectTriggers()` and triggers are per-user. A trigger runs the deployed version, not the latest push, and an existing trigger picks up a new deployment with no restart.

A run:
1. Returns immediately if `enabled` is unset
2. Takes the user lock, or exits without error
3. Loads settings and rules with `loadSettings()`, and refuses to continue without a mirror and at least one source
4. Fetches events from all source calendars within the date window
5. Filters out events matching a blacklist rule; everything else passes through
6. Builds the desired state, reads the mirror's current state, and diffs them
7. Applies creates, updates, and deletes, stopping early if the run approaches the execution limit
8. Records the result in `status`

## Critical Gotchas

### 1. Guest Lists Cause Invite Spam
Copying the guest/attendee list from a source event to the mirror will cause Google Calendar to **send invitations every day**. The user will receive notifications for people who were invited to the original event, even if they have nothing to do with the mirror. Never include an `attendees` key in the event resource.

### 2. Reminders Double-Notify
If a user is invited to both the source event and the mirrored copy, they receive two notifications if reminders are copied. Always set `reminders: { useDefault: false, overrides: [] }` on every mirrored event, regardless of source reminder settings.

### 3. Recurring Occurrences Share One iCalUID
An event's `iCalUID` is **identical across every occurrence** of a recurring series. Any identity scheme built on it alone will collapse a whole semester of a course onto a single event. The sync key includes the start time for exactly this reason — don't remove it.

### 4. Empty Rules List Mirrors Everything, Not Nothing
Rules are a blacklist, so an empty rule list excludes nothing — **every** event from **every** source calendar will be mirrored. This is the opposite of the old whitelist default (empty = mirror nothing). The page requires a **Preview** before **Turn on sync** or **Sync now**, so users see this before anything is written.

### 5. The Mirror Calendar Is Owned By The Script
Events added to the mirror by hand have no sync key and will be deleted on the next run. Don't use the mirror calendar as a place to keep your own events.

## Configuration

Everything users edit lives on the page, and is stored per user in User Properties (`settings.js`). `var CONFIG` always exists, with empty defaults, and `loadSettings()` fills it at the start of every entry point.

- The `settings` property holds JSON:
  - `mirrorCalendarId`: Set only by **Create mirror calendar**.
  - `sourceCalendars`: Array of `{ id, name, color? }` objects. `color` is an optional event-colour id (`'1'`-`'11'`) applied to every event mirrored from that calendar, so sources stay distinguishable in the mirror. `validateSources()` refuses an id outside that range, because the API rejects invalid ids outright, which would fail every write in the run.
  - `lookaheadDays`: Number of days to look ahead, from 1 to 365 (default 180), to avoid fetching infinitely recurring events.
  - `previewed`, `enabled`, `enabledAt`, `frequency`, `approvedDeletes`: The sync lifecycle. `frequency` is `daily`, `every6h` or `hourly`.
- The `status` property holds JSON: `lastRunAt`, `created`, `updated`, `deleted`, `unchanged`, `deferred` and `error`.
- The `removedRules` property holds how many unreadable rules were removed since the user last dismissed the page's notice.
- Rules are in `rule:` properties. See Rule Store. Each has:
  - `type`: `'exact'`, `'contains'` or `'regex'`
  - `value`: Text to match against the event title. For `regex`, the pattern as text.
  - `flags` (optional, `regex` only): `'i'` for case-insensitive.
  - `days` (optional): Array of day codes (`['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']`). If present, only instances starting on one of these days are excluded by this rule.
  - `time` (optional): Time window object with `start` and `end` in 24-hour format (HH:MM). If present, only events with start times within this window are excluded by this rule.
  - `date` (optional): Date range object with `start` and `end` in `YYYY-MM-DD` format, both inclusive. If present, only events starting within this range are excluded by this rule. A rule always needs a title matcher, so "Any title" stores `{ type: 'regex', value: '.*', date: ... }`.

`appsscript.json` is tracked in git. It enables the **advanced Calendar service** (`Calendar`, v3), and lists `oauthScopes` for `calendar` and `script.scriptapp`. Its `webapp` block must stay `"executeAs": "USER_ACCESSING", "access": "ANYONE"`, so each user runs as themselves. **The project must stay shared as Anyone with the link: Viewer.** With sharing off, a user's trigger fails before any of our code runs, so nothing can be recorded.

Nothing personal may ever be pushed to the shared project, because viewers can read the code. A local `config.js` from the old single-user setup is gitignored and listed in `.claspignore`. It's needed only for the migration, using `dev/export-settings.js` and `dev/import-settings.js`.

## Debugging

Apps Script's built-in logging goes to the execution transcript, and **the owner can read every user's logs**. So logs and thrown errors must never contain event titles, calendar names, calendar IDs or rule text. Log counts, timings and calendar numbers only. Text meant for the user goes to the page instead, as `previewSync()` and `describeRunError()` do. Errors from the Calendar API itself may contain calendar IDs, which we can't fully control, and the user guide says so.

Users never see a log or the editor. A failed run has to reach them through the `status` property.
