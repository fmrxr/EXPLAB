# General Chat Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user name colors, emoji reactions, moderation tools (admin delete / mute / report / banned-word filter), and click-to-load link previews to the shared General Chat in `member.html` and `dashboard.html`.

**Architecture:** All new chat logic lives in ONE new shared file, `chat.js`, exposing a `ChatEnhance` global. Both pages already load shared scripts (`auth.js`, `auth-guard.js`), so a shared `chat.js` follows the established pattern and avoids duplicating ~400 lines (emoji data, embed parser, reaction/moderation helpers) into two files that would inevitably drift. Each page keeps its own thin `renderChat`/submit handler and its own CSS class names (`.msg`/`.chat` in member, `.pmsg`/`.pchat` in dashboard), but delegates colors, embeds, reactions, picker, and moderation to `ChatEnhance`. All Firebase security-rule changes are applied once (Task 3).

> **Deviation from spec (flagged for reviewer):** The spec's Section 1 said the color hash would be *duplicated* into both pages "rather than introducing a shared JS file at this stage." Now that the full scope is visible (a ~150-emoji picker, an embed parser, reaction + moderation helpers), duplication is the wrong call — so this plan introduces the shared `chat.js` instead. Everything else matches the spec. If you'd rather keep strict duplication, stop and say so before Task 1.

**Tech Stack:** Static HTML + vanilla JS, Firebase Realtime Database (compat SDK v10.12.2), no build step. Tests run under plain `node` (no framework — this project has none); `chat.js` is written CommonJS-compatible so its pure functions are unit-testable in Node, while DOM/Firebase behavior is verified in the live browser preview.

---

## File structure

- **Create** `chat.js` — the `ChatEnhance` module: colors, emoji data + picker, embed parse/render/hydrate, reaction helpers, moderation helpers. Pure functions have no DOM/Firebase dependency; DOM/Firebase calls are lazy (inside methods) so the module loads cleanly in Node.
- **Create** `test/chat.test.js` — Node assertions for the pure functions.
- **Modify** `member.html` — load `chat.js`; extend `renderChat`/submit; add chat-upgrade CSS; add `#chatNote`.
- **Modify** `dashboard.html` — same wiring with its own class names; plus a small admin banned-word editor (Task 7).
- **Modify** `database.rules.json` — tighten `chat/$msg` write; add `reactions`, `chatMutes`, `chatReports` rules (Task 3).

A note on ordering: Tasks 1–2 (colors) and Task 4 (embeds) need no rules changes. Reactions and moderation do — so all rules land together in Task 3, early, in a single Firebase Console paste. Writes for not-yet-built features simply go unused until their UI lands.

---

## Task 1: Create `chat.js` (the full ChatEnhance module) with Node tests

**Files:**
- Create: `test/chat.test.js`
- Create: `chat.js`

- [ ] **Step 1: Write the failing test file**

Create `test/chat.test.js`:

```js
'use strict';
const assert = require('assert');
const CE = require('../chat.js');

// nameColor: deterministic, always in palette, varies across uids
(function(){
  const a = CE.nameColor('user-abc');
  assert.strictEqual(a, CE.nameColor('user-abc'), 'nameColor must be deterministic');
  assert.ok(CE.PALETTE.indexOf(a) !== -1, 'nameColor must return a palette entry');
  assert.strictEqual(CE.nameColor(''), CE.PALETTE[0] || CE.nameColor(''), 'empty uid must not throw');
  const colors = ['u1','u2','u3','u4','u5','u6','u7','u8'].map(CE.nameColor);
  assert.ok(new Set(colors).size >= 4, 'colors should spread across the palette');
})();

// buildEmbed: each platform + non-match
(function(){
  assert.deepStrictEqual(
    CE.buildEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    { type:'youtube', src:'https://www.youtube.com/embed/dQw4w9WgXcQ', label:'YouTube' });
  assert.strictEqual(CE.buildEmbed('https://youtu.be/dQw4w9WgXcQ').src,
    'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.deepStrictEqual(
    CE.buildEmbed('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'),
    { type:'spotify', src:'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT', label:'Spotify' });
  assert.strictEqual(CE.buildEmbed('https://soundcloud.com/artist/some-track').type, 'soundcloud');
  assert.strictEqual(CE.buildEmbed('https://example.com/cat.png').type, 'image');
  assert.strictEqual(CE.buildEmbed('https://example.com/cat.PNG?x=1').type, 'image');
  assert.strictEqual(CE.buildEmbed('https://www.tiktok.com/@user/video/7212345678901234567').type, 'tiktok');
  assert.strictEqual(CE.buildEmbed('https://vm.tiktok.com/ZMabc/'), null, 'short tiktok must not match');
  assert.strictEqual(CE.buildEmbed('just some text'), null);
  assert.strictEqual(CE.buildEmbed('https://example.com/page'), null);
})();

// parseEmbeds: order preserved, multiple links, ignores non-links
(function(){
  const out = CE.parseEmbeds('hi https://youtu.be/dQw4w9WgXcQ and https://example.com/a.gif end');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].type, 'youtube');
  assert.strictEqual(out[1].type, 'image');
  assert.strictEqual(CE.parseEmbeds('no links here').length, 0);
})();

// reactionSummary: counts + mine flag, stable order
(function(){
  const r = { '👍': { u1:true, u2:true }, '🔥': { u2:true } };
  const sum = CE.reactionSummary(r, 'u1');
  const thumb = sum.find(x => x.emoji === '👍');
  assert.strictEqual(thumb.count, 2);
  assert.strictEqual(thumb.mine, true);
  const fire = sum.find(x => x.emoji === '🔥');
  assert.strictEqual(fire.mine, false);
  assert.deepStrictEqual(CE.reactionSummary(null, 'u1'), []);
})();

// checkText: static banned words, case-insensitive; clean text passes; dynamic list
(function(){
  assert.ok(CE.checkText('you are a SHIT person'), 'static word should be caught (case-insensitive)');
  assert.strictEqual(CE.checkText('a perfectly nice message'), null);
  CE.setDynamicBanned(['blockme']);
  assert.ok(CE.checkText('please BLOCKME now'), 'dynamic word should be caught');
  CE.setDynamicBanned([]);
  assert.strictEqual(CE.checkText('blockme'), null, 'clearing dynamic list re-allows the word');
})();

// isMutedNow + formatUntil
(function(){
  const now = Date.now();
  assert.strictEqual(CE.isMutedNow({ until: now + 60000 }), true);
  assert.strictEqual(CE.isMutedNow({ until: now - 60000 }), false);
  assert.strictEqual(CE.isMutedNow(null), false);
  assert.strictEqual(CE.formatUntil(now + 200*365*24*3600*1000), 'indefinitely');
  assert.notStrictEqual(CE.formatUntil(now + 3600000), 'indefinitely');
})();

console.log('All chat.js unit tests passed.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/chat.test.js`
Expected: FAIL — `Cannot find module '../chat.js'`.

- [ ] **Step 3: Create `chat.js` with the full module**

Create `chat.js`:

```js
/* EXPLAB General Chat enhancements — shared by member.html and dashboard.html.
   Pure helpers (colors, parsing, summaries, text checks) have no DOM/Firebase
   dependency and are unit-tested under Node. DOM/Firebase calls are lazy. */
;(function () {
  'use strict';
  var CE = {};

  // ---------- small internal helpers ----------
  function esc(s){ return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  CE._esc = esc;
  function fb(){ return window.firebase.database(); }

  // ---------- 1. name colors ----------
  CE.PALETTE = ['#57c7ff','#8c9eff','#b388ff','#d98cff','#ff8ed6',
                '#ff9aa8','#ffc24b','#e8e070','#5fe3b0','#6db8ff'];
  CE.nameColor = function (uid) {
    var s = String(uid || ''), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return CE.PALETTE[h % CE.PALETTE.length];
  };

  // ---------- 4. link embeds ----------
  // buildEmbed(token) -> {type, src, label} | null. The capturing regex IS the
  // security boundary: only the matched id/url ever reaches an iframe/img src.
  CE.buildEmbed = function (token) {
    var m;
    if ((m = /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^ ]*&)?v=([\w-]{11})/.exec(token)) ||
        (m = /^https?:\/\/youtu\.be\/([\w-]{11})/.exec(token)))
      return { type:'youtube', src:'https://www.youtube.com/embed/' + m[1], label:'YouTube' };
    if ((m = /^https?:\/\/open\.spotify\.com\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/.exec(token)))
      return { type:'spotify', src:'https://open.spotify.com/embed/' + m[1] + '/' + m[2], label:'Spotify' };
    if (/^https?:\/\/soundcloud\.com\/[\w-]+\/[\w-]+/.test(token))
      return { type:'soundcloud',
        src:'https://w.soundcloud.com/player/?url=' + encodeURIComponent(token) + '&color=%23ff5500',
        label:'SoundCloud' };
    if ((m = /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d{6,25})/.exec(token)))
      return { type:'tiktok', src:'https://www.tiktok.com/embed/v2/' + m[1], label:'TikTok' };
    if (/^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?$/i.test(token))
      return { type:'image', src:token, label:'Image' };
    return null;
  };
  CE.parseEmbeds = function (text) {
    var out = [], toks = String(text || '').split(/\s+/);
    for (var i = 0; i < toks.length; i++) { var e = CE.buildEmbed(toks[i]); if (e) out.push(e); }
    return out;
  };
  var EMBED_ICON = { youtube:'▶', spotify:'♪', soundcloud:'♪', tiktok:'▶', image:'🖼' };
  CE.renderEmbeds = function (text) {
    return CE.parseEmbeds(text).map(function (e) {
      return '<div class="cembed" data-kind="' + e.type + '" data-src="' + esc(e.src) + '">' +
        '<button type="button" class="cembed-ph">' +
        '<span class="cembed-ic">' + EMBED_ICON[e.type] + '</span>' +
        '<span class="cembed-lb">' + esc(e.label) + '</span>' +
        '<span class="cembed-go">tap to load</span></button></div>';
    }).join('');
  };
  // Replace one placeholder with its real iframe/img. Re-validates src via buildEmbed-style guard.
  function loadEmbed(box) {
    var kind = box.getAttribute('data-kind'), src = box.getAttribute('data-src');
    if (!src) return;
    var el;
    if (kind === 'image') { el = document.createElement('img'); el.src = src; el.alt = 'image'; el.className = 'cembed-img'; }
    else {
      el = document.createElement('iframe');
      el.src = src; el.loading = 'lazy'; el.className = 'cembed-frame cembed-' + kind;
      el.setAttribute('allow', 'autoplay; encrypted-media; clipboard-write; picture-in-picture');
      el.setAttribute('allowfullscreen', '');
    }
    box.innerHTML = ''; box.appendChild(el);
  }

  // ---------- 2. reactions ----------
  CE.reactionSummary = function (reactions, myUid) {
    if (!reactions) return [];
    return Object.keys(reactions).map(function (emoji) {
      var users = reactions[emoji] || {}, uids = Object.keys(users);
      return { emoji: emoji, count: uids.length, mine: !!(myUid && users[myUid]) };
    }).filter(function (x) { return x.count > 0; });
  };
  CE.renderReactions = function (msgId, reactions, myUid) {
    return CE.reactionSummary(reactions, myUid).map(function (r) {
      return '<button type="button" class="rpill' + (r.mine ? ' on' : '') +
        '" data-id="' + esc(msgId) + '" data-emoji="' + esc(r.emoji) + '">' +
        r.emoji + '<span class="rc">' + r.count + '</span></button>';
    }).join('');
  };
  CE.toggleReaction = function (msgId, emoji, uid) {
    if (!uid || !emoji) return;
    var ref = fb().ref('chat/general/' + msgId + '/reactions/' + emoji + '/' + uid);
    ref.once('value').then(function (s) { if (s.val()) ref.remove(); else ref.set(true); });
  };

  // ---------- 3a. emoji picker ----------
  CE.QUICK = ['👍','❤️','😂','🔥','🎉','😮','😢','🙏'];
  CE.EMOJI = {
    Smileys: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 🙃 😉 😌 😍 🥰 😘 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😔 😟 🙁 😣 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🤭 🤫 😶 😐 🙄 😯 😲 🥱 😴 🤤 🤐 🥴 🤢 🤮 🤧 😷 🤒'.split(' '),
    Gestures: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤝 🙏 💪 🤲 👏 🙌 👐 🤜 🤛 ✊ 👊'.split(' '),
    Hearts: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💓 💗 💖 💘 💝'.split(' '),
    Stuff: '🔥 ✨ ⭐ 🌟 💫 ⚡ ☀️ 🌈 🎉 🎊 🎈 🎁 🏆 🥇 🎵 🎶 🎸 🎮 💡 📌 ✅ ❌ ❓ ❗ 💯 👀 🚀 🌍 🍕 ☕ 🍻 🎯'.split(' ')
  };
  var _picker = null;
  function closePicker(){ if (_picker){ _picker.remove(); _picker = null;
    document.removeEventListener('mousedown', onDocDown, true); } }
  function onDocDown(e){ if (_picker && !_picker.contains(e.target)) closePicker(); }
  CE.openPicker = function (anchor, onPick) {
    closePicker();
    var p = document.createElement('div'); p.className = 'emoji-pop';
    var quick = '<div class="emoji-quick">' + CE.QUICK.map(function (e) {
      return '<button type="button" class="emoji-b" data-e="' + esc(e) + '">' + e + '</button>'; }).join('') +
      '<button type="button" class="emoji-more">＋</button></div>';
    var grid = '<div class="emoji-grid" style="display:none">' + Object.keys(CE.EMOJI).map(function (cat) {
      return '<div class="emoji-cat">' + esc(cat) + '</div><div class="emoji-row">' +
        CE.EMOJI[cat].map(function (e) {
          return '<button type="button" class="emoji-b" data-e="' + esc(e) + '">' + e + '</button>'; }).join('') +
        '</div>'; }).join('') + '</div>';
    p.innerHTML = quick + grid;
    p.addEventListener('click', function (e) {
      var b = e.target.closest('.emoji-b');
      if (b) { onPick(b.getAttribute('data-e')); closePicker(); return; }
      if (e.target.closest('.emoji-more')) { p.querySelector('.emoji-grid').style.display = 'block'; }
    });
    document.body.appendChild(p);
    var r = anchor.getBoundingClientRect();
    p.style.top = Math.min(r.bottom + 4, window.innerHeight - p.offsetHeight - 8) + 'px';
    p.style.left = Math.min(r.left, window.innerWidth - p.offsetWidth - 8) + 'px';
    setTimeout(function () { document.addEventListener('mousedown', onDocDown, true); }, 0);
  };

  // ---------- 3b. moderation: banned words ----------
  CE.STATIC_BANNED = ['fuck','shit','bitch','asshole','cunt']; // EDIT: blunt static list; whole-word-ish, matches substrings
  var _dynamic = [];
  CE.setDynamicBanned = function (list) {
    _dynamic = (Array.isArray(list) ? list :
      String(list || '').split(/[\n,]+/)).map(function (w) { return String(w).trim().toLowerCase(); })
      .filter(Boolean);
  };
  CE.loadBannedWords = function () {
    try { fb().ref('siteConfig/bannedWords').on('value', function (s) { CE.setDynamicBanned(s.val()); }); }
    catch (e) { /* offline / no access — static list still applies */ }
  };
  CE.checkText = function (text) {
    var t = String(text || '').toLowerCase();
    var all = CE.STATIC_BANNED.concat(_dynamic);
    for (var i = 0; i < all.length; i++) { if (all[i] && t.indexOf(all[i]) !== -1) return all[i]; }
    return null;
  };

  // ---------- 3c. moderation: mutes ----------
  var YEAR = 365 * 24 * 3600 * 1000;
  var DUR = { '15m':9e5, '1h':36e5, '24h':864e5, '7d':6048e5, 'forever':100 * YEAR };
  CE.isMutedNow = function (mute) { return !!(mute && typeof mute.until === 'number' && mute.until > Date.now()); };
  CE.formatUntil = function (ts) {
    if (ts - Date.now() > 50 * YEAR) return 'indefinitely';
    return 'until ' + new Date(ts).toLocaleString([], { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  };
  CE.watchMyMute = function (uid, cb) {
    if (!uid) return;
    try { fb().ref('chatMutes/' + uid).on('value', function (s) { cb(s.val()); }); } catch (e) {}
  };
  CE.setMute = function (uid, label, reason, byUid) {
    var ms = DUR[label]; if (ms == null) return Promise.reject(new Error('bad duration'));
    return fb().ref('chatMutes/' + uid).set({ until: Date.now() + ms, by: byUid || null, reason: reason || '' });
  };
  CE.clearMute = function (uid) { return fb().ref('chatMutes/' + uid).remove(); };

  // ---------- 3d. moderation: report + delete ----------
  CE.reportMsg = function (msgId, uid, reason) {
    return fb().ref('chatReports/general/' + msgId + '/' + uid).set({ at: Date.now(), reason: reason || '' });
  };
  CE.deleteMsg = function (msgId) { return fb().ref('chat/general/' + msgId).remove(); };

  // ---------- delegated click handling for a chat host ----------
  // ctx: { uid, isAdmin, toast(msg) }. Bind once; ctx refreshed each render.
  CE.bindChatHost = function (host, ctx) {
    host.__cectx = ctx;
    if (host.__cebound) return;
    host.__cebound = true;
    host.addEventListener('click', function (e) {
      var c = host.__cectx || {};
      var ph = e.target.closest('.cembed-ph'); if (ph) { loadEmbed(ph.parentNode); return; }
      var pill = e.target.closest('.rpill');
      if (pill) { CE.toggleReaction(pill.getAttribute('data-id'), pill.getAttribute('data-emoji'), c.uid); return; }
      var rb = e.target.closest('.msg-react');
      if (rb) { var id = rb.getAttribute('data-id');
        CE.openPicker(rb, function (emoji) { CE.toggleReaction(id, emoji, c.uid); }); return; }
      var rep = e.target.closest('.msg-report');
      if (rep) { var rid = rep.getAttribute('data-id');
        var why = window.prompt('Report this message? Optional reason:', '');
        if (why === null) return;
        CE.reportMsg(rid, c.uid, why).then(function () { c.toast && c.toast('Reported — thank you'); })
          .catch(function (err) { alert('Could not report: ' + err.message); }); return; }
      var del = e.target.closest('.msg-del');
      if (del) { if (!confirm('Delete this message?')) return;
        CE.deleteMsg(del.getAttribute('data-id')).catch(function (err) { alert('Could not delete: ' + err.message); }); return; }
      var mu = e.target.closest('.msg-mute');
      if (mu) { var muid = mu.getAttribute('data-uid');
        var lab = window.prompt('Mute this user for: 15m / 1h / 24h / 7d / forever', '1h');
        if (lab === null) return; lab = lab.trim();
        if (!(lab in DUR)) { alert('Use one of: 15m, 1h, 24h, 7d, forever'); return; }
        CE.setMute(muid, lab, '', c.uid).then(function () { c.toast && c.toast('Muted ' + lab); })
          .catch(function (err) { alert('Could not mute: ' + err.message); }); return; }
    });
  };

  // ---------- exports ----------
  if (typeof module !== 'undefined' && module.exports) module.exports = CE;
  if (typeof window !== 'undefined') window.ChatEnhance = CE;
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/chat.test.js`
Expected: `All chat.js unit tests passed.`

- [ ] **Step 5: Syntax-check the module**

Run: `node --check chat.js`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add chat.js test/chat.test.js
git commit -m "Add ChatEnhance module (colors, embeds, reactions, picker, moderation) + tests"
```

---

## Task 2: Load `chat.js` and apply per-user name colors

**Files:**
- Modify: `member.html` (script include ~line 274; `renderChat` line 516; CSS line 86)
- Modify: `dashboard.html` (script include line 11; `renderChat` line 1628; CSS line 157)

- [ ] **Step 1: Load `chat.js` in `member.html`**

In `member.html`, after the `auth-guard.js` script tag (line 274), add the include. Find:

```html
<script src="auth-guard.js"></script>
<script>
```
Replace with:
```html
<script src="auth-guard.js"></script>
<script src="chat.js"></script>
<script>
```

- [ ] **Step 2: Load `chat.js` in `dashboard.html`**

In `dashboard.html`, after the `auth.js` script tag (line 11). Find:

```html
<script src="auth.js"></script>
```
Replace with:
```html
<script src="auth.js"></script>
<script src="chat.js"></script>
```

- [ ] **Step 3: Apply name color in `member.html` `renderChat`**

In `member.html`, find the message template line (line 516):

```js
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div></div>';
```
Replace with:
```js
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div></div>';
```

- [ ] **Step 4: Apply name color in `dashboard.html` `renderChat`**

In `dashboard.html`, find within line 1628:

```js
return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div></div>';
```
Replace with:
```js
return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div></div>';
```

- [ ] **Step 5: Drop the hardcoded name color so the inline style wins (both files)**

In `member.html` line 86, find:
```css
.msg .who{font-size:10px;color:var(--or);font-weight:700;letter-spacing:.03em}
```
Replace with:
```css
.msg .who{font-size:10px;font-weight:700;letter-spacing:.03em}
```

In `dashboard.html` line 157, find:
```css
.pmsg .who{font-size:10px;color:var(--or);font-weight:700}
```
Replace with:
```css
.pmsg .who{font-size:10px;font-weight:700}
```

- [ ] **Step 6: Verify in the live preview**

Start the preview server (`preview_start`) serving the project dir; open `member.html`, sign in, open General Chat. Post 2 messages from the current account, and confirm via `preview_snapshot` that the name span now carries an inline color. Use `preview_console_logs` to confirm no `ChatEnhance is not defined` errors. Repeat for `dashboard.html`. Take a `preview_screenshot` showing colored names.
Expected: names render in a palette color (not orange); a given uid is always the same color; no console errors.

- [ ] **Step 7: Commit**

```bash
git add member.html dashboard.html
git commit -m "Wire per-user name colors into chat (member + dashboard)"
```

---

## Task 3: Apply all Firebase security-rule changes

**Files:**
- Modify: `database.rules.json` (the `chat` block, lines 56–64; plus two new top-level nodes)

This single change covers: tighten `$msg` write (own-or-admin to edit/delete; mute-check + static banned regex on create), nested `reactions`, and new `chatMutes` / `chatReports` nodes. Reactions/mute/report writes simply go unused until their UI ships in later tasks.

- [ ] **Step 1: Replace the `chat` rule block**

In `database.rules.json`, find:

```json
    "chat": {
      ".read": "auth != null",
      "$room": {
        "$msg": {
          ".write": "auth != null",
          ".validate": "newData.hasChildren(['uid','text','at']) && newData.child('uid').val() === auth.uid && newData.child('text').isString() && newData.child('text').val().length <= 500"
        }
      }
    },
```
Replace with:
```json
    "chat": {
      ".read": "auth != null",
      "$room": {
        "$msg": {
          ".write": "auth != null && (data.exists() ? (data.child('uid').val() === auth.uid || root.child('accounts').child(auth.uid).child('role').val() === 'owner' || root.child('accounts').child(auth.uid).child('role').val() === 'admin') : (newData.child('uid').val() === auth.uid && (!root.child('chatMutes').child(auth.uid).child('until').exists() || root.child('chatMutes').child(auth.uid).child('until').val() <= now) && !newData.child('text').val().matches(/fuck|shit|bitch|asshole|cunt/i)))",
          ".validate": "newData.hasChildren(['uid','text','at']) && newData.child('uid').val() === auth.uid && newData.child('text').isString() && newData.child('text').val().length <= 500",
          "reactions": {
            "$emoji": {
              "$uid": {
                ".write": "auth != null && $uid === auth.uid",
                ".validate": "newData.isBoolean()"
              }
            }
          }
        }
      }
    },

    "chatMutes": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('accounts').child(auth.uid).child('role').val() === 'owner' || root.child('accounts').child(auth.uid).child('role').val() === 'admin')",
        ".write": "auth != null && (root.child('accounts').child(auth.uid).child('role').val() === 'owner' || root.child('accounts').child(auth.uid).child('role').val() === 'admin')",
        ".validate": "newData.hasChild('until') && newData.child('until').isNumber()"
      }
    },

    "chatReports": {
      ".read": "auth != null && (root.child('accounts').child(auth.uid).child('role').val() === 'owner' || root.child('accounts').child(auth.uid).child('role').val() === 'admin')",
      "$room": {
        "$msg": {
          "$uid": {
            ".write": "auth != null && $uid === auth.uid",
            ".validate": "newData.hasChild('at')"
          }
        }
      }
    },
```

**Why this shape works (notes for the implementer, not to be pasted):**
- `.write` can grant deeper but cannot revoke: the tightened `$msg.write` denies a non-author writing the message node, but the deeper `reactions/$emoji/$uid/.write` re-grants reaction writes — so anyone can react to anyone's message, while only author/admin can delete it.
- `$msg.validate` (the uid/text/at shape) is an *ancestor* of a reaction write, and Firebase does not re-run ancestor `.validate` on a descendant write — so reacting never trips the message-shape rule.
- The create branch (`!data.exists()`) enforces the mute timestamp check against the server `now` and the static banned-word regex. The regex matches substrings (the classic "Scunthorpe" caveat) — it is intentionally a blunt instrument; nuance lives in the client-side dynamic list.

- [ ] **Step 2: Validate the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('rules JSON OK')"`
Expected: `rules JSON OK`.

- [ ] **Step 3: Publish to Firebase (manual — required for writes to work)**

This environment has no Firebase CLI deploy. Copy the full contents of `database.rules.json` into the Firebase Console → Realtime Database → Rules → Publish. **Reactions, mutes, and reports will silently fail until this is published.** Flag this to the user explicitly when reaching this step.

- [ ] **Step 4: Commit**

```bash
git add database.rules.json
git commit -m "Chat rules: own-or-admin delete, mute enforcement, reactions, reports, banned-word filter"
```

---

## Task 4: Link previews (click-to-load embeds)

**Files:**
- Modify: `member.html` (`renderChat` template line 516/updated; CSS near line 88)
- Modify: `dashboard.html` (`renderChat` template line 1628/updated; CSS near line 159)

- [ ] **Step 1: Add embed CSS to `member.html`**

In `member.html`, after the `.msg .tx{...}` rule (line 88), add:

```css
.cembed{margin-top:.5rem;max-width:100%}
.cembed-ph{display:flex;align-items:center;gap:.5rem;width:100%;padding:.6rem .8rem;background:var(--s2);border:1px solid var(--bdr);border-radius:6px;color:var(--tx2);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.cembed-ph:hover{border-color:var(--bdr2)}
.cembed-ic{font-size:16px}
.cembed-lb{font-weight:700;color:var(--tx)}
.cembed-go{margin-left:auto;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3)}
.cembed-frame{width:100%;border:0;border-radius:6px}
.cembed-frame.cembed-youtube,.cembed-frame.cembed-tiktok{aspect-ratio:16/9}
.cembed-frame.cembed-spotify{height:152px}
.cembed-frame.cembed-soundcloud{height:120px}
.cembed-img{max-width:100%;border-radius:6px;display:block}
```

- [ ] **Step 2: Add the same embed CSS to `dashboard.html`**

In `dashboard.html`, after the `.pmsg .tx{...}` rule (line 159), add the identical block from Step 1 (same selectors — `.cembed*` is shared, not page-prefixed).

- [ ] **Step 3: Render embeds in `member.html`**

In `member.html`, find the (color-updated) template line and append the embeds call before the closing `</div>`. Find:

```js
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div></div>';
```
Replace with:
```js
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'</div>';
```

- [ ] **Step 4: Bind the host for click-to-load in `member.html`**

In `member.html` `renderChat`, the subscription callback sets `host.innerHTML` then scrolls. Find (line 518):

```js
    host.scrollTop=host.scrollHeight;
  },e=>{ _chatSub=false; host.innerHTML='<div class="empty">Chat unavailable: '+esc(e.message)+'</div>'; });
```
Replace with:
```js
    ChatEnhance.bindChatHost(host,{uid:SESSION&&SESSION.uid,isAdmin:!!(SESSION&&(SESSION.role==='admin'||SESSION.role==='owner'))});
    host.scrollTop=host.scrollHeight;
  },e=>{ _chatSub=false; host.innerHTML='<div class="empty">Chat unavailable: '+esc(e.message)+'</div>'; });
```

- [ ] **Step 5: Render embeds + bind host in `dashboard.html`**

In `dashboard.html` line 1628, find:
```js
return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div></div>';
```
Replace with:
```js
return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'</div>';
```
Then find (line 1629):
```js
    host.scrollTop=host.scrollHeight;
  },e=>{_chatSub=false;host.innerHTML='<div style="color:var(--red)">Chat unavailable: '+esc(e.message)+'</div>';});
```
Replace with:
```js
    var _me=pfSess();
    ChatEnhance.bindChatHost(host,{uid:_me.uid,isAdmin:(_me.role==='admin'||_me.role==='owner'),toast:(typeof showToast==='function'?showToast:null)});
    host.scrollTop=host.scrollHeight;
  },e=>{_chatSub=false;host.innerHTML='<div style="color:var(--red)">Chat unavailable: '+esc(e.message)+'</div>';});
```

- [ ] **Step 6: Verify in the live preview**

Reload `member.html` chat. Post messages containing: a YouTube watch URL, a `youtu.be` URL, a Spotify track URL, a SoundCloud track URL, a TikTok `/@user/video/<id>` URL, a direct `.jpg` URL, and a plain non-link sentence. Via `preview_snapshot` confirm each link rendered a placeholder card and the plain sentence did not. `preview_click` one placeholder, then `preview_snapshot`/`preview_network` to confirm the iframe/img loaded only after the click (no third-party request before clicking). Repeat a spot-check on `dashboard.html`. `preview_screenshot` the loaded embeds.
Expected: 6 placeholders, click loads the real media, plain text untouched, no pre-click third-party network calls.

- [ ] **Step 7: Commit**

```bash
git add member.html dashboard.html
git commit -m "Add click-to-load link previews (YouTube, Spotify, SoundCloud, TikTok, images)"
```

---

## Task 5: Reactions + emoji picker

**Files:**
- Modify: `member.html` (`renderChat` template; CSS near line 88)
- Modify: `dashboard.html` (`renderChat` template; CSS near line 159)

Requires Task 3 rules to be published for writes to persist.

- [ ] **Step 1: Add reactions + picker CSS to `member.html`**

In `member.html`, after the embed CSS added in Task 4 Step 1, add:

```css
.msg-foot{display:flex;align-items:center;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}
.rpill{display:inline-flex;align-items:center;gap:.2rem;padding:1px 7px;font-size:12px;background:var(--s2);border:1px solid var(--bdr);border-radius:10px;color:var(--tx2);cursor:pointer;line-height:1.6}
.rpill.on{border-color:var(--or);background:rgba(235,101,3,.12)}
.rpill .rc{font-size:10px;color:var(--tx3)}
.msg-react{font-size:13px;line-height:1;padding:1px 7px;background:transparent;border:1px solid var(--bdr);border-radius:10px;color:var(--tx3);cursor:pointer}
.msg-react:hover{border-color:var(--bdr2);color:var(--tx)}
.emoji-pop{position:fixed;z-index:10000;background:var(--s1);border:1px solid var(--bdr2);border-radius:8px;padding:.5rem;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:280px}
.emoji-quick{display:flex;gap:.2rem;align-items:center}
.emoji-grid{margin-top:.4rem;max-height:220px;overflow-y:auto}
.emoji-cat{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3);margin:.4rem 0 .2rem}
.emoji-row{display:flex;flex-wrap:wrap;gap:.1rem}
.emoji-b{font-size:18px;line-height:1;padding:3px;background:transparent;border:0;border-radius:4px;cursor:pointer}
.emoji-b:hover{background:var(--s2)}
.emoji-more{font-size:14px;color:var(--tx3);background:transparent;border:1px solid var(--bdr);border-radius:6px;cursor:pointer;padding:1px 8px;margin-left:auto}
```

- [ ] **Step 2: Add the same CSS to `dashboard.html`**

In `dashboard.html`, after the embed CSS added in Task 4 Step 2, add the same block from Step 1 but rename the two `.msg-foot`/`.msg-react` selectors to also cover the dashboard message: change `.msg-foot` to `.msg-foot` (shared, keep) — these classes are not page-prefixed, so paste the block **verbatim**. (The message wrappers differ — `.msg` vs `.pmsg` — but the footer/pill/picker classes are shared and identical.)

- [ ] **Step 3: Add the reaction row to the `member.html` template**

In `member.html`, find the (embed-updated) template line and insert the footer before the final `</div>`. Find:

```js
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'</div>';
```
Replace with:
```js
      const myUid=SESSION&&SESSION.uid;
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'<div class="msg-foot">'+ChatEnhance.renderReactions(k,m.reactions,myUid)+'<button type="button" class="msg-react" data-id="'+esc(k)+'">＋</button></div></div>';
```

- [ ] **Step 4: Add the reaction row to the `dashboard.html` template**

In `dashboard.html` line 1628, the row is built inside a `.map(k=>{...})`. Find:
```js
return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'</div>';
```
Replace with:
```js
const myUid=me&&me.uid;return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'<div class="msg-foot">'+ChatEnhance.renderReactions(k,m.reactions,myUid)+'<button type="button" class="msg-react" data-id="'+esc(k)+'">＋</button></div></div>';
```
(`me` is already defined at line 1627: `const me=pfSess();`.)

- [ ] **Step 5: Verify in the live preview**

Publish rules first (Task 3) if not already done. Reload `member.html` chat. Click a message's `＋` → confirm the picker opens (`preview_snapshot`); click a quick emoji → confirm a pill appears with count 1 and `.on` styling. Click the pill again → count returns to 0 / pill disappears. Click `＋` → `＋` (more) → confirm the categorized grid expands and a grid emoji also reacts. Reload the page → confirm the reaction persisted. Open the same room in `dashboard.html` → confirm the reaction shows there too (cross-page). `preview_screenshot` the pills + open picker.
Expected: reactions toggle, persist across reload, render in both pages; picker opens/closes; clicking outside closes it.

- [ ] **Step 6: Commit**

```bash
git add member.html dashboard.html
git commit -m "Add emoji reactions with quick-set + categorized picker"
```

---

## Task 6: Moderation UI (banned-word check, report, admin delete, mute)

**Files:**
- Modify: `member.html` (submit handler line 521–529; `renderChat` template + boot; markup line 263; CSS)
- Modify: `dashboard.html` (submit handler line 1633–1639; `renderChat` template + boot; markup line 891; CSS)

The delegated click handlers for `.msg-report`, `.msg-del`, `.msg-mute` already exist in `ChatEnhance.bindChatHost` (Task 1). This task adds the buttons to the template, the banned-word pre-check on submit, the `#chatNote` element, and the per-page mute watcher.

- [ ] **Step 1: Add moderation CSS to `member.html`**

In `member.html`, after the reactions CSS (Task 5 Step 1), add:

```css
.msg-tools{margin-left:.4rem;display:inline-flex;gap:.25rem}
.msg-tool{font-size:11px;line-height:1;padding:0 4px;background:transparent;border:0;color:var(--tx4);cursor:pointer}
.msg-tool:hover{color:var(--tx)}
.msg-reports{font-size:10px;color:var(--red);margin-left:.4rem;font-weight:700}
.chat-note{font-size:11px;color:var(--red);padding:.3rem .7rem;min-height:1em}
.chat-muted{font-size:12px;color:var(--tx3);padding:.7rem;border-top:1px solid var(--bdr);text-align:center}
```

In `dashboard.html`, after the reactions CSS (Task 5 Step 2), add the same block.

- [ ] **Step 2: Add `#chatNote` to both markups**

In `member.html`, find (line 260–263):
```html
        <form class="chat-input" id="chatForm">
          <input id="chatText" placeholder="Message the community…" autocomplete="off" maxlength="500">
          <button class="btn" type="submit">Send</button>
        </form>
```
Replace with:
```html
        <div class="chat-note" id="chatNote"></div>
        <form class="chat-input" id="chatForm">
          <input id="chatText" placeholder="Message the community…" autocomplete="off" maxlength="500">
          <button class="btn" type="submit">Send</button>
        </form>
```

In `dashboard.html`, find (line 888–891):
```html
      <form class="pchat-input" id="chatForm">
        <input id="chatText" placeholder="Message the community…" autocomplete="off" maxlength="500">
        <button class="au-btn" type="submit" style="background:var(--or);color:#000;border-color:var(--or)">Send</button>
      </form>
```
Replace with:
```html
      <div class="chat-note" id="chatNote"></div>
      <form class="pchat-input" id="chatForm">
        <input id="chatText" placeholder="Message the community…" autocomplete="off" maxlength="500">
        <button class="au-btn" type="submit" style="background:var(--or);color:#000;border-color:var(--or)">Send</button>
      </form>
```

- [ ] **Step 3: Add tool buttons (report / delete / mute) to the `member.html` template**

In `member.html`, update the template line from Task 5 Step 3. Find:
```js
      const myUid=SESSION&&SESSION.uid;
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'<div class="msg-foot">'+ChatEnhance.renderReactions(k,m.reactions,myUid)+'<button type="button" class="msg-react" data-id="'+esc(k)+'">＋</button></div></div>';
```
Replace with:
```js
      const myUid=SESSION&&SESSION.uid;
      const isAdmin=!!(SESSION&&(SESSION.role==='admin'||SESSION.role==='owner'));
      const rc=m.reports?Object.keys(m.reports).length:0;
      let tools='<span class="msg-tools">';
      if(!mine) tools+='<button type="button" class="msg-tool msg-report" data-id="'+esc(k)+'" title="Report">⚑</button>';
      if(isAdmin) tools+='<button type="button" class="msg-tool msg-mute" data-uid="'+esc(m.uid)+'" title="Mute user">🔇</button>';
      if(isAdmin||mine) tools+='<button type="button" class="msg-tool msg-del" data-id="'+esc(k)+'" title="Delete">✕</button>';
      tools+='</span>';
      return '<div class="msg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span>'+tools+(isAdmin&&rc?'<span class="msg-reports">⚑ '+rc+'</span>':'')+'</div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'<div class="msg-foot">'+ChatEnhance.renderReactions(k,m.reactions,myUid)+'<button type="button" class="msg-react" data-id="'+esc(k)+'">＋</button></div></div>';
```

Note: `m.reports` is only readable by admins per the rules, so non-admins always see `rc=0` — fine, the badge is admin-only anyway. Reports live under `chatReports/general/{msgId}`, NOT under the message; the badge count here reads `m.reports` which will be **undefined for everyone** because reports are a separate tree. To show real counts, the admin view needs a separate read — see Step 8 (admin report-count overlay). For now the badge is wired but will show only when Step 8 populates it.

- [ ] **Step 4: Add tool buttons to the `dashboard.html` template**

In `dashboard.html`, update the template line from Task 5 Step 4. Find:
```js
const myUid=me&&me.uid;return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span></div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'<div class="msg-foot">'+ChatEnhance.renderReactions(k,m.reactions,myUid)+'<button type="button" class="msg-react" data-id="'+esc(k)+'">＋</button></div></div>';
```
Replace with:
```js
const myUid=me&&me.uid;const isAdmin=(me.role==='admin'||me.role==='owner');const rc=(_chatReports[k]?Object.keys(_chatReports[k]).length:0);let tools='<span class="msg-tools">';if(!mine)tools+='<button type="button" class="msg-tool msg-report" data-id="'+esc(k)+'" title="Report">⚑</button>';if(isAdmin)tools+='<button type="button" class="msg-tool msg-mute" data-uid="'+esc(m.uid)+'" title="Mute user">🔇</button>';if(isAdmin||mine)tools+='<button type="button" class="msg-tool msg-del" data-id="'+esc(k)+'" title="Delete">✕</button>';tools+='</span>';return '<div class="pmsg'+(mine?' mine':'')+'"><div><span class="who" style="color:'+ChatEnhance.nameColor(m.uid)+'">'+esc(m.name||'Member')+'</span><span class="tm">'+esc(t)+'</span>'+tools+(isAdmin&&rc?'<span class="msg-reports">⚑ '+rc+'</span>':'')+'</div><div class="tx">'+esc(m.text||'')+'</div>'+ChatEnhance.renderEmbeds(m.text||'')+'<div class="msg-foot">'+ChatEnhance.renderReactions(k,m.reactions,myUid)+'<button type="button" class="msg-react" data-id="'+esc(k)+'">＋</button></div></div>';
```

- [ ] **Step 5: Add the report-count store + listener to `dashboard.html`**

In `dashboard.html`, just above `let _chatSub=false;` (line 1620), add:
```js
let _chatReports={};
```
Then inside `renderChat`, right after `_chatSub=true;` (line 1625), add an admin-only reports listener:
```js
  { const me0=pfSess(); if(me0&&(me0.role==='admin'||me0.role==='owner')){ chatRef().root.child('chatReports/general').on('value',function(rs){ _chatReports=rs.val()||{}; if(_chatSub) renderChat(); }); } }
```
Because `renderChat` early-returns when `_chatSub` is already true (just scrolling), guard against a re-entrancy loop: the listener calls `renderChat()` only to refresh, but `renderChat` will hit the `if(_chatSub){...return;}` branch and merely scroll — it will NOT rebuild. To force a rebuild when reports change, instead re-run the message render directly. Replace the listener line above with:
```js
  { const me0=pfSess(); if(me0&&(me0.role==='admin'||me0.role==='owner')){ db.ref('chatReports/general').on('value',function(rs){ _chatReports=rs.val()||{}; chatRef().limitToLast(200).once('value').then(function(sn){ _renderChatRows(sn); }); }); } }
```
This requires extracting the row-rendering into `_renderChatRows(sn)`. Refactor `renderChat` so the `on('value', sn=>{...})` body calls a named function. Find the subscription (lines 1626–1631, as updated by Tasks 2/4/5):
```js
  chatRef().limitToLast(200).on('value',sn=>{
    const v=sn.val()||{}; const ks=Object.keys(v); const me=pfSess();
    host.innerHTML=ks.length?ks.map(k=>{ /* ...row template... */ }).join(''):'<div style="color:var(--tx3)">No messages yet — say hi 👋</div>';
    var _me=pfSess();
    ChatEnhance.bindChatHost(host,{uid:_me.uid,isAdmin:(_me.role==='admin'||_me.role==='owner'),toast:(typeof showToast==='function'?showToast:null)});
    host.scrollTop=host.scrollHeight;
  },e=>{_chatSub=false;host.innerHTML='<div style="color:var(--red)">Chat unavailable: '+esc(e.message)+'</div>';});
```
Replace the opening line `chatRef().limitToLast(200).on('value',sn=>{` with:
```js
  window._renderChatRows=function(sn){
    const host=document.getElementById('chatMsgs'); if(!host)return;
```
…and keep the body, but change `},e=>{...}` close. Concretely, restructure to:
```js
  window._renderChatRows=function(sn){
    const host=document.getElementById('chatMsgs'); if(!host)return;
    const v=sn.val()||{}; const ks=Object.keys(v); const me=pfSess();
    host.innerHTML=ks.length?ks.map(k=>{ /* unchanged row template from Step 4 */ }).join(''):'<div style="color:var(--tx3)">No messages yet — say hi 👋</div>';
    ChatEnhance.bindChatHost(host,{uid:me.uid,isAdmin:(me.role==='admin'||me.role==='owner'),toast:(typeof showToast==='function'?showToast:null)});
    host.scrollTop=host.scrollHeight;
  };
  chatRef().limitToLast(200).on('value',_renderChatRows,e=>{_chatSub=false;document.getElementById('chatMsgs').innerHTML='<div style="color:var(--red)">Chat unavailable: '+esc(e.message)+'</div>';});
```

Apply the analogous `member.html` refactor only if you want admin report badges there too. Since `dashboard.html` is the admin surface, **skip the report-count overlay in `member.html`** — admins moderate from the dashboard. In `member.html`, leave `rc=0` (remove the `m.reports` reference): in Step 3, replace `const rc=m.reports?Object.keys(m.reports).length:0;` with `const rc=0;` so no misleading badge shows.

- [ ] **Step 6: Add the banned-word pre-check + mute enforcement to `member.html` submit**

In `member.html`, find the submit handler (lines 521–529):
```js
document.getElementById('chatForm').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=document.getElementById('chatText'); const text=(inp.value||'').trim();
  if(!text) return;
  if(!SESSION){ alert('Please sign in to chat.'); return; }
  inp.value='';
  chatRef().push({uid:SESSION.uid,name:SESSION.name||'Member',text:text,at:Date.now()})
    .catch(err=>{ inp.value=text; alert('Could not send: '+err.message); });
});
```
Replace with:
```js
let _muted=null;
document.getElementById('chatForm').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=document.getElementById('chatText'); const text=(inp.value||'').trim();
  const note=document.getElementById('chatNote'); if(note)note.textContent='';
  if(!text) return;
  if(!SESSION){ alert('Please sign in to chat.'); return; }
  if(ChatEnhance.isMutedNow(_muted)){ if(note)note.textContent='You are muted '+ChatEnhance.formatUntil(_muted.until)+'.'; return; }
  const bad=ChatEnhance.checkText(text);
  if(bad){ if(note)note.textContent='Message blocked — please rephrase.'; return; }
  inp.value='';
  chatRef().push({uid:SESSION.uid,name:SESSION.name||'Member',text:text,at:Date.now()})
    .catch(err=>{ inp.value=text; if(note)note.textContent='Could not send: '+err.message; });
});
```

- [ ] **Step 7: Start mute watch + banned-word load in `member.html` boot**

In `member.html` `boot(session)` (line 534+), after `SESSION=session; DB=firebase.database();`, add:
```js
  ChatEnhance.loadBannedWords();
  if(session&&session.uid) ChatEnhance.watchMyMute(session.uid,function(m){
    _muted=m;
    const inp=document.getElementById('chatText'); const note=document.getElementById('chatNote');
    if(ChatEnhance.isMutedNow(m)){ if(inp){inp.disabled=true;inp.placeholder='You are muted '+ChatEnhance.formatUntil(m.until);} }
    else { if(inp){inp.disabled=false;inp.placeholder='Message the community…';} if(note)note.textContent=''; }
  });
```

- [ ] **Step 8: Mirror submit + mute wiring in `dashboard.html`**

In `dashboard.html`, find the submit handler (lines 1633–1639):
```js
document.getElementById('chatForm').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=document.getElementById('chatText');const text=(inp.value||'').trim();if(!text)return;
  const s=pfSess(); if(!s.uid){alert('Sign in to chat.');return;}
  inp.value='';
  chatRef().push({uid:s.uid,name:s.name||currentUser||'Member',text:text,at:Date.now()}).catch(err=>{inp.value=text;alert('Could not send: '+err.message);});
});
```
Replace with:
```js
let _muted=null;
document.getElementById('chatForm').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=document.getElementById('chatText');const text=(inp.value||'').trim();
  const note=document.getElementById('chatNote'); if(note)note.textContent='';
  if(!text)return;
  const s=pfSess(); if(!s.uid){alert('Sign in to chat.');return;}
  if(ChatEnhance.isMutedNow(_muted)){ if(note)note.textContent='You are muted '+ChatEnhance.formatUntil(_muted.until)+'.'; return; }
  const bad=ChatEnhance.checkText(text);
  if(bad){ if(note)note.textContent='Message blocked — please rephrase.'; return; }
  inp.value='';
  chatRef().push({uid:s.uid,name:s.name||currentUser||'Member',text:text,at:Date.now()}).catch(err=>{inp.value=text;if(note)note.textContent='Could not send: '+err.message;});
});
ChatEnhance.loadBannedWords();
(function(){ var s=pfSess(); if(s&&s.uid) ChatEnhance.watchMyMute(s.uid,function(m){
  _muted=m;
  var inp=document.getElementById('chatText'); var note=document.getElementById('chatNote');
  if(ChatEnhance.isMutedNow(m)){ if(inp){inp.disabled=true;inp.placeholder='You are muted '+ChatEnhance.formatUntil(m.until);} }
  else { if(inp){inp.disabled=false;inp.placeholder='Message the community…';} if(note)note.textContent=''; }
}); })();
```

- [ ] **Step 9: Verify in the live preview**

Publish rules (Task 3) first. With an **admin** session in `dashboard.html`: post a message from the admin and from a second (member) browser/profile if available; confirm the admin sees ✕ on all messages and 🔇 on others, a member sees ✕ only on their own and ⚑ on others. Test: report a message (member) → confirm `chatReports` write succeeds (no error) and the admin dashboard shows `⚑ N`. Admin clicks ✕ on a member message → confirm it deletes. Admin clicks 🔇 → enters `15m` → confirm `chatMutes` write; on the muted account confirm the input disables with the "muted" placeholder and a send attempt is blocked client-side. Type a message containing a static banned word → confirm the inline note blocks it and no message is posted. `preview_console_logs` clean. `preview_screenshot` the admin tools + muted state.
Expected: role-appropriate tools; report/delete/mute writes succeed; muted input disabled; banned word blocked inline.

- [ ] **Step 10: Commit**

```bash
git add member.html dashboard.html
git commit -m "Add chat moderation: report, admin delete, mute/timeout, banned-word filter"
```

---

## Task 7: Admin editor for the dynamic banned-word list (dashboard only)

**Files:**
- Modify: `dashboard.html` (chat view markup line 884–893; a small init in the chat block)

- [ ] **Step 1: Add an admin-only editor to the dashboard chat view**

In `dashboard.html`, find (line 885):
```html
    <div class="ph"><div><div class="ph-title">General Chat</div><div class="ph-sub">Community conversation · be kind, share freely</div></div></div>
```
Replace with:
```html
    <div class="ph"><div><div class="ph-title">General Chat</div><div class="ph-sub">Community conversation · be kind, share freely</div></div></div>
    <details id="bwEditor" style="display:none;margin-bottom:.6rem">
      <summary style="cursor:pointer;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3)">Banned words (admin)</summary>
      <textarea id="bwText" class="pf-in" style="margin-top:.4rem;min-height:70px" placeholder="comma or newline separated"></textarea>
      <button class="au-btn" id="bwSave" style="margin-top:.4rem">Save list</button>
    </details>
```

- [ ] **Step 2: Wire the editor (load + save), admin-only**

In `dashboard.html`, inside the chat block (after the submit handler from Task 6 Step 8), add:
```js
(function(){
  var s=pfSess(); if(!(s&&(s.role==='admin'||s.role==='owner'))) return;
  var ed=document.getElementById('bwEditor'); if(ed) ed.style.display='';
  var ta=document.getElementById('bwText'), btn=document.getElementById('bwSave');
  db.ref('siteConfig/bannedWords').once('value').then(function(sn){
    var v=sn.val(); ta.value=Array.isArray(v)?v.join(', '):(v||'');
  });
  if(btn) btn.addEventListener('click',function(){
    var list=ta.value.split(/[\n,]+/).map(function(w){return w.trim();}).filter(Boolean);
    db.ref('siteConfig/bannedWords').set(list).then(function(){ if(typeof showToast==='function')showToast('Banned list saved ✓'); })
      .catch(function(err){ alert('Save failed: '+err.message); });
  });
})();
```

- [ ] **Step 3: Verify in the live preview**

As admin in `dashboard.html`, open the "Banned words (admin)" disclosure, add a word, save → confirm `showToast` and that `siteConfig/bannedWords` updated. Then in chat, try posting that word → confirm the dynamic check blocks it inline (the `loadBannedWords` listener picks up the change live). Confirm a non-admin does not see the editor.
Expected: admin can edit; new word blocks immediately; editor hidden for members.

- [ ] **Step 4: Commit**

```bash
git add dashboard.html
git commit -m "Add admin editor for dynamic banned-word list"
```

---

## Task 8: Full integration pass + mobile + final verification

**Files:** none (verification only), unless fixes are needed.

- [ ] **Step 1: Re-run unit tests and syntax checks**

Run:
```bash
node test/chat.test.js
node --check chat.js
node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8'));console.log('rules OK')"
```
Expected: tests pass, no syntax errors, rules OK.

- [ ] **Step 2: End-to-end preview walkthrough (member.html)**

Reload chat. Confirm together in one session: distinct name colors across ≥2 uids; a message with a YouTube + image link shows two click-to-load cards; reactions toggle and persist; own-message ✕ deletes; ⚑ report on others; banned word blocked inline. `preview_console_logs` must be clean.

- [ ] **Step 3: Responsive check**

`preview_resize` to 390px width. Confirm: message bubbles, reaction pills, embed cards, and the emoji picker stay within the viewport and are usable; the picker repositions inside the screen (its clamp logic). `preview_screenshot` mobile.

- [ ] **Step 4: Disclosed-limitation note**

A single preview session cannot fully exercise two-different-logged-in-accounts enforcement (e.g. proving a muted *other* account is server-rejected, or that a non-author truly cannot delete). These are enforced by the Task 3 rules and verified by code review; report them as "verified at the rules level, not end-to-end live-tested," consistent with prior authenticated-flow features in this project.

- [ ] **Step 5: Final commit (if any fixes were made)**

```bash
git add -A -- member.html dashboard.html chat.js test/chat.test.js database.rules.json
git commit -m "Polish + responsive fixes for chat upgrade"
```

> **Do not** `git add -A` broadly — five unrelated files (`index.html`, `member-form.html`, and prior edits) carry pending uncommitted work from earlier sessions and must stay untouched. Stage only the chat-upgrade files by explicit path.

---

## Self-review notes (addressed in this plan)

- **Spec coverage:** colors (Task 2), reactions + picker (Task 5), moderation — admin delete (Task 6), mute (Task 6), report (Task 6), banned-word static+dynamic (Tasks 3/6/7) — and embeds incl. TikTok (Task 4). Rules gap fix (own-or-admin delete) in Task 3.
- **Report-count badge caveat:** reports live in a separate admin-only tree, so the badge is dashboard-only (member.html shows none) — made explicit in Task 6 Steps 3–5 rather than left as a silent `m.reports` that never populates.
- **Rules ordering caveat:** rules land in Task 3 before the UI that exercises them; the manual Console publish is called out as a hard prerequisite for reaction/mute/report persistence.
- **Testing reality:** no test framework exists; pure functions get real Node assertions, everything else gets live-preview verification — the project's actual verification method.
