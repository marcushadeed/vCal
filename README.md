# vCal

vCal gathers your calendars into one mirror calendar, and leaves out the events you don't want. Every event is copied unless a rule excludes it, and the mirror stays in sync with its sources.

- [User guide](#user-guide): if someone gave you a link.
- [Deployer guide](#deployer-guide): if you run your own copy.

# User guide

## Get started

1. Open the link you were given, and sign in with your Google account.
2. Google warns that the app isn't verified. Choose **Advanced**, then **Go to vCal**, and allow access. vCal needs to read your calendars, write to its mirror calendar, and schedule its own syncs.
3. Follow the steps on the page:
   1. Name your mirror, and click **Create mirror calendar**. Pick a name you'll recognise, especially if you share it. You can rename it later under **Calendars**.
   2. Tick your source calendars, choose names and colours if you like, and click **Save calendars**.
   3. Add rules for anything you want left out. This is optional, and you can add more later.
   4. Click **Preview** to see what a sync would do. A preview changes nothing.
   5. Choose how often to sync, and click **Turn on sync**.

A large first sync can take several runs to finish. **Sync now** runs one straight away.

## Rules

A rule describes events to **leave out**. An event that matches no rule is copied.

| Match | Excludes events whose title |
|---|---|
| Exact title | is exactly this, ignoring spaces at either end |
| Title contains | contains this, ignoring upper and lower case |
| Regex (advanced) | matches this regular expression |
| Any title | is anything. Needs a day, time or date limit, because it would otherwise empty your mirror |

Any rule can also be limited to certain days, a time window or a date range. These use your calendar's time zone. A time window looks only at when an event starts: it excludes events starting at or after the From time and before the To time, not every event that overlaps it. All-day events count as starting at 12:00 AM. A To time of 12:00 AM means midnight at the end of the day.

Under **Upcoming**, each event also offers **Block this** for that one occurrence, and **Block all titled this**. Both add to your list of rules.

Rules match on title and start time, so:

- A rule applies across all your source calendars.
- Renaming an event, or moving a blocked occurrence, breaks its block, and the event returns to the mirror.
- Changing your calendar's time zone breaks **Block this** rules, because they store a local date and time.

Changes apply at the next sync. A rule with a date range is removed 30 days after the range ends.

## Time

**Time** is a pie chart of this week, last week, this month or last month, split between your source calendars and unscheduled time. It counts only the events vCal mirrors, and leaves out all-day and declined events. Time in more than one calendar at once gets its own slice, so the slices add up to the whole period. Weeks start on the day set in your Google Calendar settings.

Google Calendar's own Time Insights can't show this, because it reads only your primary calendar.

## The mirror belongs to vCal

**Anything you add to the mirror calendar by hand gets deleted at the next sync.** Keep your own events somewhere else.

If you delete the mirror calendar, the page says so and offers **Create mirror calendar** again.

## If vCal stops before deleting events

If a sync would delete more than half of your mirror, and at least 10 events, vCal stops and tells you on the page. This protects you from a rule that matches more than you meant. Click **Preview** to check the list. If it's what you want, click **Sync now**. Otherwise, fix the rule, and the next sync carries on as normal.

## What the owner can do

vCal runs on its owner's Apps Script project. The owner can see when your syncs ran, and controls the code that can read and change your calendars. Google's error messages, which the owner can see, may include calendar IDs.

## If the page won't load

Google web apps often fail when you're signed in to more than one Google account. Try an incognito window, or sign out of the others.

## How to stop

1. Click **Pause**. This stops future syncs.
2. Remove vCal's access at [Google account connections](https://myaccount.google.com/connections).

The mirror calendar stays until you delete it.

# Deployer guide

## Before you start

Read these first. They all follow from how shared Apps Script web apps work.

- **Use a new Apps Script project.** Don't share a project that has ever held personal calendar data, because it may remain in saved versions.
- **The project must stay shared as Anyone with the link: Viewer.** A user's trigger fails without it, before any of vCal's code runs. So turning sharing off breaks every user's sync, with no recorded error. The page can only warn them that a sync is overdue.
- **Never push anything personal.** Viewers can read the code. `config.js` is in `.claspignore`, so check that `clasp status` doesn't list it.
- **A deployment reaches every user's next scheduled run**, with no action from them. Run the tests and try the change in a separate testing project first (see [Testing project](#testing-project)). Don't use a test deployment of the real project: it shares settings, rules and the mirror with the real one for whichever account opens it, so **Sync now** there runs untested code against that account's real mirror.
- **You can read every user's logs.** So logs must never contain event titles, calendar names, calendar IDs or rule text.
- **Unverified apps are limited to 100 users, for the lifetime of the project.** Users also see the unverified-app warning.

## Set up locally

```
git clone https://github.com/marcushadeed/vCal.git
cd vCal
npm install
npm install -g @google/clasp
```

If you don't have npm, follow the [install instructions](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm).

Turn on **Google Apps Script API** at [script.google.com/home/usersettings](https://script.google.com/home/usersettings). Without it, clasp fails with a "User has not enabled the Apps Script API" error.

## Run the tests

```
npm test
```

This runs `dev/run-tests.js` in two time zones. It needs only Node, and touches no calendar or Apps Script project. It also checks that the page's script compiles. `runTests` can be run in the Apps Script editor too.

## Create and deploy

1. Log in, and create the project:
   ```
   clasp login
   clasp create --type standalone --title vCal
   ```
2. `clasp create` overwrites `appsscript.json`, so restore it:
   ```
   git checkout appsscript.json
   ```
3. Run `clasp status`, and confirm `config.js` isn't listed.
4. Push:
   ```
   clasp push --force
   ```
   `--force` is required. Without it the manifest isn't updated, and the push still reports success. The first symptom is `Calendar is not defined`.
5. Deploy:
   ```
   clasp deploy
   ```
6. In the Apps Script editor, click **Share**, and set the project to **Anyone with the link: Viewer**.
7. In the editor, click **Deploy**, then **Manage deployments**, and copy the **Web app** URL. That's the link to share.

## Testing project

A second Apps Script project, **vCal-testing**, for trying changes against live Google services. Its `.clasp-testing.json` is gitignored.

Pushing to the real project doesn't reach users, since they run the deployed version. The testing project is still worth it, because:

- **A new version is whatever you pushed last.** Keeping work in progress out of the real project means it's always ready to deploy a fix.
- **Viewers can read the real project's latest push** right away, before any deployment.

User Properties, triggers and logs are per project, so it has its own settings, rules and mirror calendar, even under your own account. Changes tried there can only affect your own calendars.

To set it up:

1. In an empty folder, run `clasp create --type standalone --title vCal-testing`, and copy the `.clasp.json` it makes to `.clasp-testing.json` in the repo.
2. Run `npm run push:testing`. Leave the project's link sharing off.
3. In the testing project's editor, click **Deploy**, then **Test deployments**, and open the **Web app** URL. Create a mirror, and pick your sources. Your real calendars are fine.

It shares your account, so:

- **Don't pick your real mirror as a source.** It's listed in the picker.
- **Prefer Sync now, and keep its sync paused.** Its runs count against your Calendar API quota.

`clasp -P` needs an absolute path, or it fails with "escapes project root". The npm script handles this.

## Update

1. Run `npm run push:testing`. It runs the tests first.
2. Open the testing project's test deployment, and try the change with **Preview** and **Sync now**.
3. Run `npm run push:prod`. This doesn't affect users, because triggers and the link run the deployed version.
4. In the editor, click **Deploy**, then **Manage deployments**, edit the deployment, choose **New version** and click **Deploy**. The link stays the same, and every user's next run uses the new code.

See `CLAUDE.md` for how the code works.
