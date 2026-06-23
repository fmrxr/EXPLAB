/* EXPLAB site accent theming — admin picks an accent in the dashboard; every page
   reads siteConfig/themeAccent and recolors the accent CSS variables live.
   When unset, pages keep their own CSS defaults. Hardcoded rgba() colors are
   unaffected — only the CSS custom properties below follow the accent. */
;(function () {
  'use strict';
  function clean(h){ if(!h) return null; h=String(h).trim(); if(h[0] !== '#') h='#'+h;
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h) ? h : null; }
  function rgb(h){ h=h.slice(1); if(h.length===3) h=h.split('').map(function(c){return c+c;}).join('');
    var n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; }
  function apply(hex){
    hex=clean(hex); if(!hex) return;
    var c=rgb(hex), t=c[0]+','+c[1]+','+c[2], s=document.documentElement.style;
    s.setProperty('--or', hex);
    s.setProperty('--grn', hex);
    s.setProperty('--or-rgb', t);
    s.setProperty('--bdr', 'rgba('+t+',0.16)');
    s.setProperty('--bdr2', 'rgba('+t+',0.4)');
    s.setProperty('--bdr3', 'rgba('+t+',0.6)');
    window.__accent = hex;
    try{ localStorage.setItem('xl_accent', hex); }catch(e){}
  }
  // Apply cached accent immediately to avoid a color flash before Firebase responds.
  try{ var cached = localStorage.getItem('xl_accent'); if(cached) apply(cached); }catch(e){}
  function watch(){
    try{ window.firebase.database().ref('siteConfig/themeAccent').on('value', function(s){ apply(s.val()); }); }
    catch(e){}
  }
  window.applyTheme = apply;
  window.watchTheme = watch;
})();
