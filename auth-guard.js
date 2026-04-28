/* Drop into any gated page after firebase + auth.js. Hides the page until auth
   resolves, redirects to login if anonymous, then reveals.
   To require admin, set <body data-auth="admin"> on the page. */
(function () {
  'use strict';
  const root = document.documentElement;
  const prevVis = root.style.visibility;
  root.style.visibility = 'hidden';

  function start() {
    const adminOnly = document.body && document.body.dataset.auth === 'admin';
    window.ExplabAuth.requireAuth({ adminOnly }).then(session => {
      root.style.visibility = prevVis || '';
      // Expose for pages that want to show the user's name etc.
      window.__explabSession = session;
      document.dispatchEvent(new CustomEvent('explab:auth', { detail: session }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
