# Purpose

This exists for multiple purposes:

1. Gather multiple shared calendars into one single, editable calendar
2. Automatically filter events copied into that mirror calendar, to reduce clutter
3. Filter + re-run functionality allows for some syncing with source calenders

# Steps to run:

## Setting up Local

1. Clone this repo to local. It needs to be local so you can edit the config and push it to Apps Script

```
git clone https://github.com/marcushadeed/vCal.git
```

2. Install packages from `package-lock.json` by running
```
npm install
```

If you don't have npm, follow the [install instructions](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) and try again

## Creating the Config

Before pushing the code to Google Scripts, you must configure your calendar sources and filters

1. Copy `config.example.js` and rename the new file `config.js`. You may remove all the comments in `config.js` to improve readability

2. [Create a new Google Calendar](https://calendar.google.com/calendar/u/0/r/settings/createcalendar). This will be your mirror calendar

3. Once created, get the mirror calendar ID. (three lines in top right of Google Calendar web -> locate the mirror under `My calendars` -> hover over -> click three dots -> Settings and sharing -> Calendar ID under `Integrate calendar`). Will have the format `abc123@group.calendar.google.com`

4. Paste the mirror calendar ID as the value under the `mirrorCalendarId` field in `config.js`

5. Add your source calendars by adding one JSON object for each. Grab the calendar ID for each source and add it as the value under `id`. Copy the name from the calendar and set it as the value under `name`

6. Add your filters as JSON objects under `rules` following the instructions in the `config.example.js` comments

## Pushing to Google Scripts via CLASP

1. Enable the Apps Script API for your account: go to [script.google.com/home/usersettings](https://script.google.com/home/usersettings) and turn on "Google Apps Script API". CLASP will fail on `create`/`push` with a "User has not enabled the Apps Script API" error if you skip this.

2. Log in to CLASP with the Google account that should have the mirror calendar by following the instructions
```
clasp login
```

3. Create a new Google Scripts project with the title `vCal` (or whatever you want it to be)
```
clasp create --title vCal
```

4. Check your CLASP setup by running

```
clasp status
```

You should see the following as being tracked
```
Tracked files:
└─ appsscript.json
└─ config.js
└─ Rules.js
└─ Tests.js
└─ Sync.js
```

5. Push to CLASP
```
clasp push
```

## Testing in Google Scripts

1. Refresh/open your project in [Google Scripts](https://script.google.com/home)

2. Navigate to the `Tests.gs` file, select `runTests`, accept permissions, and check that all tests pass.

3. Navigate to `Sync.gs`, ensure that `DRY_RUN` is set to `true`, select `mirrorCalendarSync`as the function to run, and run it. Check that the output is what you want.

4. To see the logged output of either run, open the `Executions` tab (clock-with-arrow icon in the left sidebar) and click into the most recent execution, or use `View > Logs` (Ctrl+Enter) from the editor immediately after a run.

## Running in Google Scripts

1. Set `DRY_RUN` to `false` in `Sync.gs`, then run `mirrorCalendarSync` again.

2. Check the mirror calendar itself to confirm the events created match what the dry run predicted.

3. Add a time-driven trigger so the sync runs automatically: in the Apps Script editor, open the `Triggers` tab (clock icon in the left sidebar) → `+ Add Trigger` → set "Choose which function to run" to `mirrorCalendarSync`, "Select event source" to `Time-driven`, and pick a `Day timer` (a daily run is what the wipe-and-rebuild reconciliation strategy is designed around — see `CLAUDE.md`) at whatever time of day works for you, then `Save`.