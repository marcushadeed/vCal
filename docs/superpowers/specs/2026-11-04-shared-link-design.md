# Shared link with no code edits

## Context

Using vCal today means cloning the repo, editing `config.js`, changing `DRY_RUN` in `sync.js`, pushing with clasp and adding a trigger in the editor.

**Success:** someone opens one link, authorizes with their own Google account and does everything on the page. They never see code, the Apps Script editor or a log.

**Decisions made:**
- Distribution is a shared web app running as each user (`USER_ACCESSING`, `ANYONE`).
- Everything users edit moves to the page in one go.
- The rule form offers Exact title, Title contains, Regex (advanced) and Any title, with optional days, time and date limits.

## What the test project showed

Tested with a second Google account that had no edit access.

| Question | Result | Consequence |
|---|---|---|
| Can a non-editor's trigger run as them? | Yes, 8 runs in a row, including a calendar read | Scheduled sync works on a shared link |
| Is link sharing needed? | **Yes.** With sharing off, the trigger fails before any of our code runs | The project must stay **Anyone with the link: Viewer** |
| Which code does a trigger run? | The deployed version, not the latest push | `clasp push` alone doesn't affect users |
| Are `getUserProperties()` and triggers per-user? | Yes | Per-user settings work |
| Can the owner read other users' logs? | **Yes** | Logs must never contain calendar content |
| Does an existing trigger pick up a new deployment? | Yes, with no restart | A deployment reaches every user's next scheduled run, with no action from them |

Since a deployment reaches everyone at once, a bad release affects every user's next run. The deployer guide says to run `runTests()` and try the change on a separate test deployment first.

## Consequences of link sharing

**Use a new Apps Script project for the shared deployment.** The current project has held `config.js`, with personal calendar IDs and rules, and may keep it in deployed versions. It stays private. Nothing personal may ever be pushed to the new project after sharing is turned on.

**Turning sharing off breaks everyone's sync with no trace.** The failure happens before our code runs, so nothing can be recorded. Two things follow:
- The deployer guide must warn about this.
- The page warns when the last recorded run is older than the chosen frequency allows, instead of relying only on stored errors.

**Users must be told what the owner can do.** The page and user guide state plainly that the owner can see that their syncs ran, and that the owner controls the code that runs with write access to their calendars.

## Settings and storage

New `settings.js`:
- `var CONFIG` always exists, with empty defaults. This removes the "CONFIG is not defined" paths in `sync.js` and `tests.js`.
- `loadSettings()` fills `CONFIG` from `getUserProperties()` at the start of every entry point, in today's shape, so most of `sync.js` stays unchanged.
- It refuses a mirror that is the primary calendar or is also a source.
- A `settings` property holds JSON: `mirrorCalendarId`, `sourceCalendars`, `lookaheadDays`, `previewed`, `enabled`, `frequency`.
- A `status` property holds last run time, counts, deferred changes and last error.

Removed: `config.js`, `config.example.js`, `DRY_RUN`, `logDryRun()`.

## Rules

Config rules and page blocks become one list. `blocks.js` becomes the rule store.

- One property per rule, keyed `rule:<md5 of the rule JSON>`, in `getUserProperties()`. The reasons for one property per rule still apply.
- Stored rules are plain JSON. Regex rules store `{ type: 'regex', value: pattern, flags }`, and `loadRules()` compiles them for `CONFIG.rules`. The page always receives the stored form, because a `RegExp` can't pass through `google.script.run`.
- `flags` is only ever `''` or `'i'`. The form offers a "case-insensitive" checkbox. `g` and `y` are refused because they make `RegExp.test()` keep state between calls, which would skip matches.
- `ruleMatchesTitle()` gains `contains`: trimmed and case-insensitive.
- "Any title" stores regex `.*`, so excluding everything over a holiday needs no regex knowledge.
- New pure `validateRule()` checks for a known type, a non-empty value, a compilable regex, valid day codes, `HH:MM` times with start before end, and valid dates with start not after end.
- Editing writes the new rule, then deletes the old one, since keys are content hashes.
- Rules are deleted 30 days after their date range ends, using the user's time zone. Rules match on start date but the sync reads events still running, so deleting one sooner would bring back a multi-day event it excluded.
- An unreadable stored rule is deleted when rules load, with only a count logged, and the page shows a notice until it's dismissed. Users have no editor to repair one, and the worst outcome is that its events return to the mirror. A test fixes the stored rule shapes that must keep validating, so tightening `validateRule()` can't delete them for every user.
- `classifyEvent()` loses its `'config'` case, and the "blocked by config.js" label goes away. **Block this** and **Block all titled this** stay, and add to the same list.

## Time zones

Rule times must follow each user's time zone, but `getHours()`, `getDay()` and similar always use the script's.

- Rule functions take plain local parts: `matchesRules(title, { date, day, minutes })`. They no longer need a `Date`, so they become purer.
- `localStartParts(start, timeZone)` converts an API `start`:
  - `dateTime`: formatted once per event with `Utilities.formatDate()`.
  - `date`: used as is, with `minutes: 0`. The weekday is worked out from the date, with no time-zone conversion.
- `collectEvents()`, `toPageEvent()` and `buildBlockRule()` use it.
- The time zone comes from the user's primary calendar, read once per run.
- **`computeSyncKey()` keeps using `parseEventStart()` unchanged.** The script's time zone is fixed, so all-day keys stay stable, and changing them would rebuild every mirror.

## Calendars

- **Create mirror calendar** is the only way to set a mirror on the page, because the sync deletes everything in the mirror without a sync key. Users can't point it at an existing calendar.
- Sources come from a picker backed by `Calendar.CalendarList.list`, with an editable name and a colour dropdown using `EVENT_COLOR_NAMES`. The mirror is left out of the picker.
- An unreadable calendar still fails the run, as `CLAUDE.md` requires. The stored error names the calendar, so the user can fix or remove it on the page.

## Sync lifecycle

- `mirrorCalendarSync()` splits so that **Preview** and a real sync build the plan the same way.
- **Preview** makes no writes and returns the plan to the page: counts, plus creates, updates, deletes and excludes, each with title, start, source and reason. It sets `previewed`.
- **Turn on sync** requires `previewed`. It replaces any existing trigger and creates one for the chosen frequency: daily (default), every 6 hours or hourly.
- **Pause** deletes the trigger and clears `enabled`.
- A scheduled run with `enabled` unset does nothing, so a leftover trigger can't write anything.
- **Sync now** is available after a preview, and lets a large first sync finish over several passes.
- `LockService.getUserLock()` wraps sync, because **Sync now** can overlap a scheduled run. A run that can't get the lock exits without error, and **Sync now** tells the user another run is in progress.
- **A run stops before a mass delete**: more than half of the mirror, and at least 10 events. A preview is only required once, so this protects against a later rule that matches too much. The page explains what happened. A preview approves as many deletes as it showed, and only **Sync now** can use that approval, so a scheduled run never carries out a mass delete.
- Extra copies in the mirror with the same sync key are deleted, keeping the first.
- Every run records its result in `status`. Failures are stored, then rethrown.

## Page

`index.html` keeps its current patterns: `textContent` only, `callServer`, and reloading after each action.

- **First run** is a guided setup: create mirror, pick sources, add rules (optional), preview, turn on.
- **After setup** the sections are Status, Calendars (with the lookahead field), Rules and Upcoming.
- **Status** shows sync on or paused, frequency, last run, counts, deferred changes and any error, plus the stale-run warning.
- **Failed loads** mention Google's multiple-account limitation and suggest an incognito window.

## Privacy

The owner can read every user's logs, so logs and thrown errors must not contain event titles, calendar names, calendar IDs or rule text.

- Remove event and calendar text from the log lines in `collectEvents()` and `applyPlan()` (`sync.js:109`, `116`, `118`, `140`, `469`, `480`, `491`). Counts and timings stay.
- `validateRule()` errors describe the problem without repeating the value. Failed page calls are logged too.
- Errors from the Calendar API itself may contain calendar IDs, and we can't fully control that. The user guide says so.

## Manifest

`appsscript.json`: `USER_ACCESSING`, `ANYONE`, the existing `Calendar` service, and explicit `oauthScopes` for `calendar` and `script.scriptapp`.

## Migrating Marcus's setup

Sync keys derive only from calendar ID, iCalUID and start time, so the new project can adopt the existing mirror with no rewrites.

1. In the old project, a temporary function logs settings and blocks as JSON. It stays private there.
2. Create the new project with link sharing **off**, and push the code.
3. In the new project's editor, run a temporary import function with that JSON pasted in as an object, with no quotes around it, then delete it. Inside a string, regex escapes would change with no error. This must happen before the first deployment, so the data never lands in a saved version.
4. Run **Preview** in the new deployment. Expect close to zero changes.
5. Delete the old project's trigger, then **Turn on sync** on the page.
6. Check that the project's code holds nothing personal, then turn on link sharing.

## Not in scope

- Google verification. The app stays under the 100-user lifetime cap and shows the unverified-app warning. Verification needs a privacy policy and may need narrower scopes.
- A "delete my data" feature.

## Files

- **New:** `settings.js`
- **Major changes:** `index.html`, `webapp.js`, `blocks.js`, `tests.js`
- **Smaller changes:** `rules.js`, `sync.js`, `appsscript.json`
- **Removed:** `config.example.js`
- **Docs:** `README.md` splits into a short user guide and a deployer guide. `CLAUDE.md` updates its trigger, webapp access, Filter Logic, Dry Run, Page-Made Blocks, Configuration, Testing, Debugging and gotcha 4 sections.

## Verification

**Automated, in `runTests()`:**
- `validateRule()` accepts and refuses the cases above, and its errors don't repeat the value.
- `contains` matching, and regex rules round-tripped through JSON, including refused flags.
- `localStartParts()` across time zones, including all-day events near midnight.
- Mirror safety refusals in `loadSettings()`.
- The stale-run calculation.
- `testMatchesRules` no longer depends on `config.js`.

**Manual, on Marcus's account:** after migration, **Preview** shows close to zero changes. This proves the migration and time-zone changes kept existing behaviour.

**Manual, with the second account, ideally in another time zone:**
1. Complete setup from the link, and confirm **Preview** writes nothing.
2. **Turn on sync**, and confirm events appear and the trigger fires.
3. Add a rule of each type, and confirm its events leave the mirror at the next sync.
4. Confirm a rule with a time limit matches in that account's time zone.
5. **Pause**, and confirm no further runs.
6. Confirm neither account sees the other's rules or settings.
7. As the owner, confirm the second account's logs contain no event titles, calendar names or IDs.
8. As the second account, confirm the Executions page doesn't show other users' runs. It already can't show their logs.
