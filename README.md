# Purpose

This exists for two purposes:

1. Gather multiple shared calendars into one single, editable calendar
2. Automatically filter events in your personal calendar to reduce clutter
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

1. Log in to CLASP with the Google account that should have the mirror calendar by following the instructions
```
clasp login
```

2. Create a new Google Scripts project with the title `vCal` (or whatever you want it to be)
```
clasp create --title vCal
```

3. Check your CLASP setup by running

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

4. Push to CLASP
```
clasp push
```

## Testing in Google Scripts

1. Refresh/open your project in [Google Scripts](https://script.google.com/home)

2. Navigate to the `Tests.gs` file, select `runTests`, accept permissions, and check that all tests pass.

3. Navigate to `Sync.gs`, ensure that `DRY_RUN` is set to `true`, select `mirrorCalendarSync`as the function to run, and run it. Check that the output is what you want.

## Running in Google Scripts

1. Set `DRY_RUN` to `false`, and run

> Scheduled deployment instructions here