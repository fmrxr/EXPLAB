# EXPLAB

Community platform for new media arts in Tunis. Static site deployed at [explab.netlify.app](https://explab.netlify.app/).

## Stack
- Static HTML, no build step
- Firebase Auth (email + password) and Realtime Database (project `explab-8b504`)
- Hosted on Netlify

## Pages
- [`index.html`](index.html) — landing page and Tools for the Community grid
- [`member-form.html`](member-form.html) — 8-step member form; submitting it creates the user's Firebase account
- [`register.html`](register.html) — claim an existing account (requires a `/members` entry)
- [`login.html`](login.html) — email + password sign-in, with password reset
- [`dashboard.html`](dashboard.html) — admin-only directory of members and submissions
- [`manifesto.html`](manifesto.html), [`event-guide.html`](event-guide.html), [`manifesto-workbook.html`](manifesto-workbook.html), [`explab-mindmap-3d.html`](explab-mindmap-3d.html) — gated tools

## Auth model
- **Owner:** `fmrxr.studio@gmail.com`
- **Admins:** declared in [`auth.js`](auth.js)
- **Members:** anyone with a record under `/members` — created automatically when the member form is filled

Form fills create accounts; account claims require an existing member record. No orphan accounts, no orphan members.

## Files
- [`auth.js`](auth.js) — shared `ExplabAuth` module (init, sign-in/up, role logic, account/member linking)
- [`auth-guard.js`](auth-guard.js) — drop-in protection for gated pages
- [`database.rules.json`](database.rules.json) — Firebase Realtime Database security rules
- [`netlify.toml`](netlify.toml) — Netlify config
