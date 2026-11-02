# Blocking page for vCal (issue #8)

## Context

Blocking an event today means editing `config.js` and running `clasp push`. Issue #8 asks for a UI to select events to block instead.

**Success:** pick an event on a page, block it, and see it gone from the mirror after the next sync, with no `config.js` or `clasp` involved. Blocks can be seen and undone. `config.js` stays for setup and existing rules.

**Decisions made:**
- Separate page, hosted as an Apps Script web app (not a Chrome extension or Calendar add-on).
- Each event offers "block this occurrence" or "block all with this title".
- Blocks are ordinary rules, stored at runtime and merged with `CONFIG.rules`.
- Blocks apply at the next sync. No "Sync now" button.
- The page has a title search box.

## Backend

### `blocks.js` (new)

- `buildBlockRule(scope, title, startTime)`: pure, returns a rule in the existing format.
  - `'title'` scope: `{ type: 'exact', value: title }`. Throws on an empty or whitespace-only title, which would otherwise block every untitled event.
  - `'occurrence'` scope: same, plus `date` (that single day, via `formatDate()`) and a one-minute `time` window, `[HH:MM, HH:MM+1)`. A 23:59 start gives an end of `24:00`, which `parseTimeToMinutes()` handles. Untitled events are allowed.
- `parseEventStart(start)`: pure, turns an API `start` into a `Date`. `date` values are parsed as local (`new Date(y, m - 1, d)`), because `new Date('2026-12-25')` is UTC midnight, which is Dec 24 in New York. `dateTime` values parse directly.
- `loadBlockRules()`, `addBlock(rule)`, `removeBlock(key)`: Script Properties store.
  - One property per block, keyed `block:<md5Hex of the rule JSON>`. This avoids the 9KB-per-value limit and read-modify-write races, and re-blocking is idempotent.
  - Corrupt JSON throws, like a malformed rule date does.
- `pruneExpiredBlocks()`: deletes blocks whose `date.end` is before today. Called on page load.

### `webapp.js` (new)

- `doGet()`: serves `index.html` via `HtmlService`.
- `getPageData()`: prunes expired blocks, merges rules, and returns blocks, events and warnings.
  - Events come from `Calendar.Events.list` per source calendar (`singleEvents`, paginated, `orderBy: 'startTime'`), over the same window as the sync. `CalendarApp` is avoided because of its per-event calls (#7).
  - Each event is `{ title, start, allDay, sourceName, blockedBy }`, using `findMatchingRule()` and `parseEventStart()`. `blockedBy` is `'page'`, `'config'` or null.
  - A calendar that can't be read adds a warning, and the others still load.
- `blockEvent(scope, title, startIso, allDay)` and `unblock(key)`: page actions. The rule is built server-side so times use the script time zone.

### `sync.js`

One new line at the top of `mirrorCalendarSync()`, after the `CONFIG` check, merges `loadBlockRules()` into `CONFIG.rules` for that run. Each execution has fresh globals, so this doesn't persist. `matchesRules()` is unchanged, and the existing diff deletes blocked copies and recreates unblocked ones. `DRY_RUN` still applies.

## Page: `index.html` (new)

Plain JS, no build step.

- Header note: "Changes apply at the next sync".
- **Your blocks:** description and an Unblock button for each.
- **Upcoming:** events grouped by day, showing time, title and source. Unblocked events get `Block this` and `Block all titled this`; untitled events get only `Block this`. Blocked events are labelled "blocked by you" or "blocked by config.js", with no undo on the latter.
- **Search box:** case-insensitive title filter, client-side, applied to Upcoming only. Day headings with no matches are hidden.
- After each action, reload via `getPageData()`, keeping the search text. Single code path, at the cost of a short wait per click.
- Failed server calls show a banner and leave the list as it was.
- Event text is inserted with `textContent`, never `innerHTML`, because anyone who can edit a shared calendar controls it.

## Known limits (document these)

- A title block applies across all source calendars.
- Renaming an event, or moving an occurrence, breaks its block, so the event returns to the mirror.
- Two same-titled events at the same minute are blocked together by an occurrence block.

## Files

- **New:** `blocks.js`, `webapp.js`, `index.html`
- **Edit:** `sync.js` (merge line), `tests.js` (new cases), `README.md` (deployment steps, `webapp` manifest block, tracked files list), `CLAUDE.md` (architecture, limits, testing)
- **Local only, gitignored:** `appsscript.json` needs `"webapp": { "executeAs": "USER_DEPLOYING", "access": "MYSELF" }`

**Reused from `rules.js`:** `findMatchingRule()`, `formatDate()`, `parseTimeToMinutes()`. **From `sync.js`:** `md5Hex()`, `describeRule()`.

## Execution

1. Work on a new branch off `main`.
2. Save this design to `docs/superpowers/specs/2026-11-01-block-ui-design.md`.
3. Write tests first, then `blocks.js`, then the sync merge, `webapp.js` and `index.html`, then docs.
4. Commit only when you ask.

## Verification

**Automated, in `runTests()`** (follow the `CONFIG.rules` swap and restore pattern in `testMatchesRules()`, `tests.js:153`):
- Occurrence rule matches that occurrence, but not a sibling on another day or at another time.
- Title rule matches all instances, and refuses an empty title.
- All-day occurrence and a 23:59 start both match correctly.
- `parseEventStart('YYYY-MM-DD')` gives the right local day.

**Manual, by you in Apps Script** (needs `clasp push --force` and a web app deployment). With `DRY_RUN = true`:
1. Open the page, and confirm events and existing `config.js` exclusions show correctly.
2. Search by title.
3. Block one occurrence, run the sync, and confirm the log shows `EXCLUDE` for it but not its siblings.
4. Block all with a title, and confirm all instances show `EXCLUDE`.
5. Unblock both, and confirm the `EXCLUDE` lines are gone.
6. Set `DRY_RUN = false` and repeat one block and unblock to confirm the mirror copy is deleted and recreated.
