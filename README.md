# Purpose

This project serves multiple purposes:

1. Gather multiple shared calendars into one single, editable calendar.
2. Automatically filter events copied into that mirror calendar to reduce clutter.
3. Support filter-and-re-run functionality to keep the mirror in sync with source calendars.

# Setup and Usage

## 1. Set Up Locally

1. Clone this repo. It needs to be local so you can edit the config before pushing it to Apps Script.
  ```
   git clone https://github.com/marcushadeed/vCal.git
  ```
2. Install packages from `package-lock.json`:
  ```
   npm install
  ```
   If you don't have npm, follow the [install instructions](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) and try again.

## 2. Create the Config

Before pushing the code to Apps Script, configure your calendar sources and filters.

1. Copy `config.example.js` and rename the copy to `config.js`. You may remove the comments in `config.js` to improve readability.
2. [Create a new Google Calendar](https://calendar.google.com/calendar/u/0/r/settings/createcalendar). This will be your mirror calendar.
3. Get the mirror calendar's ID: open the hamburger menu (three lines, top left) in Google Calendar → find the mirror calendar under **My calendars** → hover over it and click the three dots → **Settings and sharing** → copy the **Calendar ID** under **Integrate calendar**. It will look like `abc123@group.calendar.google.com`.
4. Paste that ID as the value of `mirrorCalendarId` in `config.js`.
5. Add your source calendars under `sourceCalendars`, one JSON object per calendar. Set `id` to the calendar's ID and `name` to a label of your choosing.
6. Add your filters under `rules`, following the instructions in the `config.example.js` comments.

## 3. Push to Apps Script via CLASP

1. Enable the Apps Script API for your account: go to [script.google.com/home/usersettings](https://script.google.com/home/usersettings) and turn on **Google Apps Script API**. Without this, CLASP fails on `create`/`push` with a "User has not enabled the Apps Script API" error.
2. Log in to CLASP with the Google account that should own the mirror calendar:
  ```
   clasp login
  ```
3. Create a new Apps Script project (name it `vCal`, or whatever you prefer):
  ```
   clasp create --title vCal
  ```
4. Check your CLASP setup:
  ```
   clasp status
  ```
   You should see the following files tracked:
  ```
  Tracked files:
  └─ appsscript.json
  └─ Rules.js
  └─ config.js
  └─ Sync.js
  └─ Tests.js
  ```
5. Push to Apps Script:
  ```
   clasp push
  ```

## 4. Test in Apps Script

1. Open your project in the [Apps Script editor](https://script.google.com/home).
2. Open `Tests.gs`, select the `runTests` function, run it, accept the permission prompts, and confirm all tests pass.
3. Open `Sync.gs`, confirm `DRY_RUN` is set to `true`, select `mirrorCalendarSync` as the function to run, and run it. Confirm the output matches what you expect.
4. To view the logged output of any run, open the **Executions** tab (clock-with-arrow icon in the left sidebar) and select the most recent execution, or use **View > Logs** (Ctrl+Enter) from the editor immediately after a run.

## 5. Run for Real

1. Set `DRY_RUN` to `false` in `Sync.gs`, then run `mirrorCalendarSync` again.
2. Check the mirror calendar itself to confirm the created events match what the dry run predicted.
3. Add a time-driven trigger so the sync runs automatically: in the Apps Script editor, open the **Triggers** tab (clock icon in the left sidebar) → **+ Add Trigger** → set "Choose which function to run" to `mirrorCalendarSync`, "Select event source" to `Time-driven`, and pick a `Day timer` at whatever time of day works for you. A daily run is what the wipe-and-rebuild reconciliation strategy is designed around — see `CLAUDE.md`. Click **Save**.

