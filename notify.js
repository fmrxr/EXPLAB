/* EXPLAB notifications — shared by member.html and dashboard.html.
   In-app bell (count + dropdown) + toast + OS popup (Notifications API).
   Session-based only; no service worker / no closed-app push. */
;(function () {
  'use strict';
  var N = {};
  var list = [];      // {title, body, at}
  var unread = 0;
  var bellEl = null, badgeEl = null, dropEl = null;
  var permAsked = false;

  function esc(s){ return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function timeAgo(ts){ var s=Math.floor((Date.now()-ts)/1000);
    if(s<60)return 'just now'; if(s<3600)return Math.floor(s/60)+'m ago';
    if(s<86400)return Math.floor(s/3600)+'h ago'; return new Date(ts).toLocaleDateString(); }

  function injectCSS(){
    if(document.getElementById('notify-css')) return;
    var s=document.createElement('style'); s.id='notify-css';
    s.textContent=[
      '.ntf-bell{position:relative;background:transparent;border:1px solid var(--bdr,#333);color:var(--tx2,#ccc);font-size:14px;line-height:1;padding:5px 9px;cursor:pointer;border-radius:2px}',
      '.ntf-bell:hover{border-color:var(--bdr2,#666)}',
      '.ntf-badge{position:absolute;top:-7px;right:-7px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--or,#eb6503);color:#000;font-size:10px;font-weight:700;line-height:16px;text-align:center;display:none}',
      '.ntf-drop{position:fixed;z-index:10001;width:300px;max-width:88vw;max-height:60vh;overflow-y:auto;background:var(--s1,#111);border:1px solid var(--bdr2,#555);border-radius:8px;box-shadow:0 10px 36px rgba(0,0,0,.6);display:none}',
      '.ntf-drop.open{display:block}',
      '.ntf-hd{display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;border-bottom:1px solid var(--bdr,#333);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3,#999);position:sticky;top:0;background:var(--s1,#111)}',
      '.ntf-clear{background:transparent;border:0;color:var(--tx3,#999);font-size:11px;cursor:pointer}',
      '.ntf-clear:hover{color:var(--or,#eb6503)}',
      '.ntf-item{padding:.6rem .8rem;border-bottom:1px solid rgba(255,255,255,.05)}',
      '.ntf-item .t{font-size:13px;color:var(--tx,#eee);font-weight:700}',
      '.ntf-item .b{font-size:12px;color:var(--tx2,#bbb);margin-top:2px;word-break:break-word}',
      '.ntf-item .tm{font-size:10px;color:var(--tx4,#777);margin-top:3px}',
      '.ntf-empty{padding:1.2rem .8rem;color:var(--tx3,#999);font-size:12px;text-align:center}',
      '.ntf-toasts{position:fixed;right:14px;bottom:14px;z-index:10002;display:flex;flex-direction:column;gap:.5rem;max-width:300px}',
      '.ntf-toast{background:var(--s1,#111);border:1px solid var(--bdr2,#555);border-left:3px solid var(--or,#eb6503);border-radius:6px;padding:.6rem .8rem;box-shadow:0 8px 24px rgba(0,0,0,.5);animation:ntfin .25s ease}',
      '.ntf-toast .t{font-size:13px;font-weight:700;color:var(--tx,#eee)}',
      '.ntf-toast .b{font-size:12px;color:var(--tx2,#bbb);margin-top:2px}',
      '@keyframes ntfin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  function toastHost(){
    var h=document.getElementById('ntfToasts');
    if(!h){ h=document.createElement('div'); h.id='ntfToasts'; h.className='ntf-toasts'; document.body.appendChild(h); }
    return h;
  }
  function showToast(title,body){
    var d=document.createElement('div'); d.className='ntf-toast';
    d.innerHTML='<div class="t">'+esc(title)+'</div>'+(body?'<div class="b">'+esc(body)+'</div>':'');
    toastHost().appendChild(d);
    setTimeout(function(){ d.style.transition='opacity .3s'; d.style.opacity='0'; setTimeout(function(){ d.remove(); },300); }, 5000);
  }

  function renderBell(){
    if(badgeEl){ badgeEl.textContent=unread>9?'9+':String(unread); badgeEl.style.display=unread?'block':'none'; }
    if(dropEl){
      var rows=list.length ? list.slice(0,40).map(function(n){
        return '<div class="ntf-item"><div class="t">'+esc(n.title)+'</div>'+
          (n.body?'<div class="b">'+esc(n.body)+'</div>':'')+
          '<div class="tm">'+timeAgo(n.at)+'</div></div>';
      }).join('') : '<div class="ntf-empty">No notifications yet.</div>';
      dropEl.innerHTML='<div class="ntf-hd"><span>Notifications</span><button class="ntf-clear">Clear</button></div>'+rows;
      var cl=dropEl.querySelector('.ntf-clear');
      if(cl) cl.onclick=function(e){ e.stopPropagation(); list=[]; unread=0; renderBell(); };
    }
  }

  N.fire=function(o){
    o=o||{}; var title=o.title||'Notification', body=o.body||'';
    list.unshift({title:title,body:body,at:Date.now()});
    if(list.length>80) list.length=80;
    unread++;
    renderBell();
    showToast(title,body);
    try{ if(window.Notification && Notification.permission==='granted'){
      var n=new Notification(title,{body:body}); setTimeout(function(){ try{n.close();}catch(e){} },6000);
    } }catch(e){}
  };

  function positionDrop(){
    if(!bellEl||!dropEl) return;
    var r=bellEl.getBoundingClientRect();
    dropEl.style.top=(r.bottom+6)+'px';
    dropEl.style.right=Math.max(8,(window.innerWidth-r.right))+'px';
  }
  function toggleDrop(){
    if(!dropEl) return;
    var open=dropEl.classList.toggle('open');
    if(open){ unread=0; renderBell(); positionDrop(); }
    if(!permAsked && window.Notification && Notification.permission==='default'){
      permAsked=true; try{ Notification.requestPermission(); }catch(e){}
    }
  }

  N.mountBell=function(container){
    if(!container || document.getElementById('ntfBell')) return;
    injectCSS();
    bellEl=document.createElement('button'); bellEl.id='ntfBell'; bellEl.className='ntf-bell';
    bellEl.title='Notifications'; bellEl.setAttribute('aria-label','Notifications');
    bellEl.innerHTML='🔔<span class="ntf-badge" id="ntfBadge"></span>';
    container.insertBefore(bellEl, container.firstChild);
    badgeEl=bellEl.querySelector('#ntfBadge');
    dropEl=document.createElement('div'); dropEl.className='ntf-drop'; dropEl.id='ntfDrop';
    document.body.appendChild(dropEl);
    bellEl.addEventListener('click',function(e){ e.stopPropagation(); toggleDrop(); });
    document.addEventListener('click',function(e){
      if(dropEl.classList.contains('open') && !dropEl.contains(e.target) && e.target!==bellEl) dropEl.classList.remove('open');
    });
    renderBell();
  };

  // Generic "new child" watcher: snapshot existing keys once (baseline), then
  // fire only for child_added keys not in the baseline. mapFn(key,val) -> {title,body} | null.
  N.watchNew=function(ref, mapFn){
    if(!ref) return;
    var baseline=null;
    ref.once('value').then(function(s){
      baseline={}; var v=s.val()||{}; Object.keys(v).forEach(function(k){ baseline[k]=true; });
      ref.on('child_added',function(c){
        if(!baseline) return;
        if(baseline[c.key]) return;     // existed at page load
        baseline[c.key]=true;
        try{ var o=mapFn(c.key, c.val()); if(o) N.fire(o); }catch(e){}
      }, function(){});
    }).catch(function(){});
  };

  if(typeof module!=='undefined' && module.exports) module.exports=N;
  if(typeof window!=='undefined') window.Notify=N;
})();
