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
  // Replace one placeholder with its real iframe/img.
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
    Smileys: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 🙃 😉 😌 😍 🥰 😘 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😔 😟 🙁 😣 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🤭 🤫 😶 😐 🙄 😯 😲 🥱 😴 🤤 😐 🤢 🤮 🤧 😷 🤒'.split(' '),
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
    _picker = p;
    setTimeout(function () { document.addEventListener('mousedown', onDocDown, true); }, 0);
  };

  // ---------- 3b. moderation: banned words ----------
  CE.STATIC_BANNED = ['fuck','shit','bitch','asshole','cunt']; // EDIT: blunt static list; matches substrings
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
