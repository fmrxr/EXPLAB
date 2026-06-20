# EXPLAB — Event Modes, Dashboard CMS & Per‑Event Waitlist

**Date:** 2026-06-20
**Status:** Approved (design)
**Repo:** fmrxr/EXPLAB (Netlify deploy folder)

## Overview

Today the homepage is hardcoded to a single Workshop #001 (green theme) with an
archived Gathering #001 (orange artwork). This feature makes events **data‑driven**
and gives the admin a dashboard CMS to manage them.

A single **active event** is the source of truth. Its `type` drives the **site theme**
(orange = Gathering, green = Workshop), the **header button**, and the **"Next event"**
section content on the index. Each event can collect signups via a **per‑event waitlist**.

Two build phases:
- **Phase A** — data model, Events CMS in the dashboard, theme switching, index reads the active event.
- **Phase B** — per‑event waitlist generalization + live sidebar count badge.

## Data model (Firebase Realtime Database)

```
events/{id} = {
  type:        "gathering" | "workshop",   // drives theme + heading word
  number:      "001",                        // shown as "#001"
  description: "Hands-on intro to …",
  date:        "2026-06-26",                 // ISO; rendered dd/mm/yyyy
  timeRange:   "17H00–20H00",
  location:    "MOUHIT SPACE, TUNIS",
  capacity:    10,                            // rendered "~10 people"
  program:     [ { time:"17H00–17H30", label:"TouchDesigner onboarding…" }, … ],
  registration:true,                          // show register box + waitlist
  status:      "active" | "past" | "upcoming",
  createdAt:   1719000000000
}

siteConfig/activeEventId = "<id>"             // the one active/next event
waitlist/{id}/{entryId}   = { email, name, member, at, … }   // keyed by event id
```

Heading is derived: `"{Type} #{number}"` (e.g. "Workshop #001"). No separate title field.

### Security rules (add to database.rules.json + Firebase console)

`events` and `siteConfig` must be **publicly readable** (the index renders from them)
and **admin‑writable**. Without this they fall under `$other` (admin‑only read) and the
public site can't load them.

```json
"events":     { ".read": true, ".write": "auth != null && (owner||admin)" },
"siteConfig": { ".read": true, ".write": "auth != null && (owner||admin)" }
```

(`waitlist` rules already added in the prior change — public create, admin manage.)

## Theme system (index.html)

Orange = Gathering, Green = Workshop. Driven by `<html data-theme="…">`.

- Define both palettes as CSS variables scoped to `[data-theme]`:
  - `[data-theme="gathering"]`: `--or:#eb6503; --or2:#ff8c2a; --or-rgb:235,101,3`
  - `[data-theme="workshop"]`: `--or:#3feb03; --or2:#6dff3d; --or-rgb:63,235,3`
- Convert the current hardcoded green rgba borders/glows (`rgba(63,235,3,…)`) to
  `rgba(var(--or-rgb),…)` so they follow the theme.
- Button text stays **black** (legible on both orange and green).
- **Logo/icon:** replace the baked‑green data‑URI `<img>`s with an inline SVG sprite
  (`<symbol id="ex-logo">`, `<symbol id="ex-icon">`) referenced via `<use>` and filled
  with `fill:var(--or)` (a `.dark` variant uses `fill:#000` for icons sitting on accent
  buttons). The logo now recolors with the theme automatically.
- **Flash avoidance:** apply the last‑known theme synchronously from `localStorage`
  (`xl_theme`) in a tiny inline `<head>` script; then Firebase confirms/updates it.

## Header

The nav "Gathering" item becomes **dynamic**: its label and anchor reflect the active
event — "Workshop" → `#workshop` in green mode, "Gathering" → `#gathering` in orange mode.
The next‑event section gets a stable `id` the button links to.

## Index rendering

- On load, read `siteConfig/activeEventId` → its event. Set `data-theme` by `type`,
  populate the **Next event** section (heading, description, program list, date line) and
  the **register box** (shown only if `registration` is true; joins `waitlist/{activeId}`).
- **Archive** section lists events with `status:"past"` (newest first).
- The current hardcoded Workshop #001 / Gathering #001 markup remains as a no‑JS fallback
  and is overwritten by the Firebase render when available.

## Dashboard — Events CMS (admin‑only)

- New sidebar item **"Events"** (shown for owner/admin, like Waitlist).
- `view-events`: grid of event cards (type badge, "#number", date, status, an "ACTIVE"
  marker). Actions per card: **Edit · Delete · Set active**. A **"+ New event"** button.
- **Set active** = the fast theme switch: sets `siteConfig/activeEventId`, flips the
  previously‑active event to `status:"past"`, sets the chosen to `"active"`. The live site
  changes theme + content on next load (and immediately in any open tab via the listener).
- **Create/Edit** uses a modal mirroring the existing roadmap modal pattern: type select,
  number, description, date, timeRange, location, capacity, registration toggle, and a
  **program‑row editor** (add/remove `{time,label}` rows).
- **Initialize events** action (admin): if `events` is empty, seed the two current events
  (Gathering #001 = past/orange/registration off; Workshop #001 = active/green/registration
  on) and set `activeEventId`, so the site looks identical to today but data‑driven.

## Waitlist generalization + sidebar badge (Phase B)

- Waitlist keyed per event id (generalize current `waitlist/workshop-001`).
- Index register box, dashboard Waitlist view, and the new sidebar **count badge** all
  follow `activeEventId`. The Waitlist view header shows the active event's name.
- Sidebar "Waitlist" item shows a **live count** of `waitlist/{activeId}` (Firebase `.on`).
- Homepage + member‑form write to `waitlist/{activeId}` instead of the literal id.

## Out of scope (YAGNI)

Multiple simultaneous active events, recurring events, email reminders, a public
all‑events listing page, drag‑reorder of cards, per‑event custom themes beyond
orange/green.

## Verification

- JSON/JS syntax checks (`node --check`, `python -m json.tool`).
- Index: toggle `data-theme` and confirm accent + logo recolor; confirm next‑event section
  renders from a seeded event; confirm archive lists past events.
- Dashboard (requires owner login): create/edit/delete event, Set active flips theme,
  waitlist view + badge follow the active event.
- Rules: confirm public read of `events`/`siteConfig`, admin‑only write.
- Note: full authenticated dashboard writes need owner login (not available to the agent);
  those steps are verified structurally + by the owner.
