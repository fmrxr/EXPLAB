'use strict';
const assert = require('assert');
const CE = require('../chat.js');

// nameColor: deterministic, always in palette, varies across uids
(function(){
  const a = CE.nameColor('user-abc');
  assert.strictEqual(a, CE.nameColor('user-abc'), 'nameColor must be deterministic');
  assert.ok(CE.PALETTE.indexOf(a) !== -1, 'nameColor must return a palette entry');
  assert.ok(CE.PALETTE.indexOf(CE.nameColor('')) !== -1, 'empty uid must not throw');
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

// reactionSummary: counts + mine flag
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
