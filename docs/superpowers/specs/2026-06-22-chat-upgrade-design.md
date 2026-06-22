# General Chat Upgrade — Design Spec

Date: 2026-06-22

## Goals

Expand General Chat (shared `chat/general` Firebase room, rendered independently in both `member.html` and `dashboard.html`) with distinct per-user name colors, emoji reactions, moderation tools, and rich link previews for music/video. Make chat feel alive and identifiable, while closing a real security gap in the current rules.

## Current state

- `chat/general/{msgId}: {uid, name, text, at}`, rendered via `.limitToLast(200).on('value')` full re-render, in both `member.html` (`renderChat`/`chatRef`) and `dashboard.html` (same pattern, independently duplicated).
- Current rule gap: `$msg.write = "auth != null"` lets ANY signed-in user edit or delete ANY message, not just their own. This spec fixes that as part of the moderation work.
- All names render in the single theme-accent color; no reactions; no embeds; no moderation.

## Out of scope (deferred)

- **Custom uploaded emoji** (Phase 2) — first use of Firebase Storage in this project; needs upload UI plus its own moderation. `storageBucket` is provisioned in the Firebase config but the Storage SDK/script isn't loaded anywhere yet.
- **Per-user override of their auto-assigned color** — auto-only for v1.
- **A fully dynamic, server-enforced banned-word list** — structurally impossible with Realtime Database rules alone (the rules language can't loop over runtime data). Would require Cloud Functions, a bigger infra addition not justified here. The hybrid static+soft-dynamic approach below (Section 3) is the permanent answer for this project, not a stopgap.
- **TikTok short-link resolution** (`vm.tiktok.com` / `vt.tiktok.com`) — these redirect server-side to the full URL; a static client can't safely follow that redirect. Short links fall back to plain text; full `tiktok.com/@user/video/{id}` links get the rich card.

## Suggested build order

The four feature areas below are independent of each other and don't need to ship as one big bang:

1. **Colors** — trivial, no data/rules changes, ships first.
2. **Reactions** — one rules addition, biggest UI surface (picker).
3. **Moderation** — most rules changes, highest value (closes the existing delete-anything gap).
4. **Link previews** — pure rendering layer, no data/rules changes, can land anytime after colors.

## 1. Per-user name colors

- Deterministic hash of `uid` → index into a fixed palette of 10 colors (sky cyan, periwinkle, violet, orchid, pink, rose, gold, pale yellow, seafoam, azure), chosen to avoid collision with the brand green/orange theme accents and the red/blue used in the boot-loader glitch effect.
- Color is computed from `uid`, not `name`, so it stays stable even if a member renames later.
- Applies to the `.who` name span for every message, including the viewer's own — the existing "mine" right-aligned/tinted-background treatment stays for placement; color is purely about identity.
- No new data, no rules changes. The hash function is duplicated into `member.html` and `dashboard.html`, matching how chat logic is already independently duplicated in each rather than introducing a shared JS file at this stage.

## 2. Reactions

- **Data:** `chat/general/{msgId}/reactions/{emoji}/{uid} = true`. The emoji character itself is the object key. Removing a reaction deletes the key (not `false`), so counts are just `Object.keys(...).length`.
- **UI:** every message gets an always-visible (not hover-only, so it works on touch) small react button. Tapping it opens a popover: a curated quick-set row (~6 emoji) on top for one-tap reacting, plus a "+" that expands into a hand-rolled categorized grid (~200 emoji across Smileys / Gestures / Hearts / Objects) for anything else. Hand-rolled rather than a third-party picker library/web component, to avoid fighting Shadow DOM styling and keep zero new dependencies — consistent with the rest of this site's bespoke CSS.
- Existing reactions render as pills under the message text (emoji + count), highlighted if the viewer is one of the reactors; tapping a pill toggles the viewer's own reaction.
- **Rules:** nested under the existing `$msg` node, `reactions/$emoji/$uid` — any signed-in user can write only their own uid key, value must be boolean `true`. This doesn't disturb the existing `$msg`-level validate (the message still has its required `uid`/`text`/`at` children untouched when a reaction is added).

## 3. Moderation

- **Admin delete-any + self-delete-own.** `$msg.write` becomes: creating a message still just requires being signed in (validate already enforces `uid === auth.uid`, so no impersonation); editing/deleting an *existing* message requires being its author OR admin/owner. This both adds admin delete-any and fixes the current gap where any signed-in user can delete anyone's message. Self-delete-own falls out of the same rule for free.
- **Mute / timeout.** New top-level node `chatMutes/{uid}: {until, by, reason}`. `until` is always a concrete timestamp — an "indefinite" mute just uses a sentinel ~100 years out — so enforcement is a single numeric comparison added to the `$msg` create-branch: rejected if `chatMutes/{auth.uid}/until >= now`. This is real server-side enforcement, not just a hidden UI control. `.read`: self or admin/owner (so the client can show a "you're muted" banner). `.write`: admin/owner only. Muted members see "You're muted until \<date>" (or "indefinitely") in place of the input box; admins get mute/unmute controls with quick durations (15m / 1h / 24h / 7d / indefinite) and an optional reason.
- **Report message.** New top-level node `chatReports/general/{msgId}/{uid}: {at, reason}`, keyed by reporter uid so the same person can't double-report. `.read`: admin/owner only — reports cannot live inside the publicly-readable message tree, because Firebase Realtime Database read rules cascade downward with no way to carve out an exception for a sub-node (mirrors the existing `waitlist` admin-only-read pattern, separate from the public `attendees` counter, for the same structural reason). `.write`: any signed-in user, only their own uid key. Members get a small flag icon; admins see a "⚑ N reports" badge on flagged messages with a one-tap delete shortcut right there.
- **Banned-word filter (hybrid — the permanent design here, not a v1 stopgap).** A small **static** list hardcoded directly into the `$msg` create-validate via a literal `.matches()` regex — real, unbypassable enforcement, but changing it needs a rules edit and a manual Firebase Console republish. The actual word list is a content decision for the user/admin to supply at implementation time, not a technical placeholder. Plus a **dynamic**, admin-editable list at `siteConfig/bannedWords` (reuses the existing public-read/admin-write `siteConfig` node — no new top-level rule needed) checked client-side before sending — flexible day-to-day, but technically bypassable by anyone editing the JS directly. This combination is the practical ceiling without adding Cloud Functions.

## 4. Link previews (click-to-load, fully consistent — no auto-loading exceptions)

- Parsed at render time from the existing `text` field via anchored regexes — nothing new is stored, no rules changes for this section.
- **Supported:** YouTube (`youtube.com/watch`, `youtu.be`), Spotify (track/album/playlist/episode), SoundCloud, direct image links (`.png`/`.jpg`/`.gif`/`.webp`), TikTok (`tiktok.com/@user/video/{id}` only — see short-link caveat above).
- Every type, including images, shows a generic local placeholder first (▶ / ♪ / 🖼 + platform name) with zero network contact — only on tap does the real iframe (`youtube.com/embed/{id}`, `open.spotify.com/embed/{type}/{id}`, SoundCloud's player, `tiktok.com/embed/v2/{id}`) or the actual image `src` load. Applying this uniformly (rather than letting "lower-risk" types like images or YouTube thumbnails auto-load) keeps the click-to-load choice honest with no silent exceptions.
- Card renders below the message text, inside the same bubble, capped to its existing max-width; multiple links in one message simply stack multiple cards.
- **Security:** the extracted ID/URL going into an iframe/img `src` is validated by the same strict, anchored regex that extracted it — not just HTML-escaped like the visible text. That regex is the actual XSS boundary, since a crafted message could otherwise inject something unexpected into a `src` attribute.
- Fails safe: anything that doesn't cleanly match just renders as plain text, no error shown.

## Error handling

- Best-effort writes (reactions) fail silently, retry-able by tapping again — consistent with existing best-effort patterns like the public attendee counters.
- Primary actions (send, report, apply mute) show an `alert()` on failure, consistent with the existing `chatForm` submit handler.
- A muted client proactively disables its input via its own `chatMutes` listener; if a write is rejected anyway, that's caught and shown as "You're muted," not a raw Firebase error string.
- The banned-word soft-block shows an inline message under the input, not an alert.

## Testing / verification

- `node --check` on every edited file's inline script.
- JSON validation of `database.rules.json` after edits.
- Live preview walkthrough covering: distinct colors across ≥2 uids, reactions persisting across reload, moderation controls admin-only, a muted banner under a simulated mute, all 5 embed types going placeholder → real on click, and mobile breakpoints.
- Disclosed limitation: a single preview session can't fully exercise two-different-logged-in-accounts scenarios (e.g. confirming a muted second account is actually blocked from posting). Those are verified at the rules/code level and will be disclosed as not live-tested end-to-end, consistent with how prior authenticated-flow features in this project were handled.

## Rules changes summary

(Manual Firebase Console paste required to publish, as with every prior rules change in this project — no CLI deploy available in this environment.)

- Tighten `chat/$room/$msg` write (own-or-admin for edit/delete; mute-check and static banned-word regex on create).
- Add nested `chat/$room/$msg/reactions/$emoji/$uid`.
- Add new top-level `chatMutes/$uid`.
- Add new top-level `chatReports/$room/$msg/$uid`.
- `siteConfig/bannedWords` needs no new rule — reuses the existing `siteConfig` read/write rule.
