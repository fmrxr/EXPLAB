/* EXPLAB shared auth — Firebase Auth (email + password) on top of the existing Realtime DB.
   Loaded by login/register and by auth-guard on gated pages.
   Requires firebase-app-compat, firebase-auth-compat, firebase-database-compat to be loaded
   before this script. */
(function (global) {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyCc8BtjpFO4N-41BkWUu7rj-C_HcIsa_ng",
    authDomain:        "explab-8b504.firebaseapp.com",
    databaseURL:       "https://explab-8b504-default-rtdb.firebaseio.com",
    projectId:         "explab-8b504",
    storageBucket:     "explab-8b504.firebasestorage.app",
    messagingSenderId: "563591097872",
    appId:             "1:563591097872:web:c8bd366fe0f83df5e92495",
    measurementId:     "G-R4Q9MMX9H6"
  };

  // Owner + admins by email. Owner is admin-of-admins.
  const OWNER_EMAIL  = 'fmrxr.studio@gmail.com';
  const ADMIN_EMAILS = [
    'fmrxr.studio@gmail.com',
    'meriamgaied@gmail.com',
    'flifel.seif@outlook.com'
  ];

  function init() {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return { auth: firebase.auth(), db: firebase.database() };
  }

  function roleFor(email) {
    if (!email) return 'member';
    const e = email.toLowerCase();
    if (e === OWNER_EMAIL.toLowerCase()) return 'owner';
    if (ADMIN_EMAILS.map(x => x.toLowerCase()).includes(e)) return 'admin';
    return 'member';
  }

  // Find an existing /members entry whose email matches; returns its key or null.
  async function findMemberIdByEmail(db, email) {
    if (!email) return null;
    const snap = await db.ref('members').once('value');
    const all = snap.val() || {};
    const target = email.trim().toLowerCase();
    for (const [id, m] of Object.entries(all)) {
      const e = (m && (m.identity?.email || m.email)) || '';
      if (e && e.toLowerCase() === target) return id;
    }
    return null;
  }

  // Create or refresh /accounts/{uid} after sign-in, link to /members by email.
  async function ensureAccountRecord(db, user) {
    const ref = db.ref('accounts/' + user.uid);
    const existing = (await ref.once('value')).val() || {};
    const memberId = existing.memberId || await findMemberIdByEmail(db, user.email);
    const role     = existing.role && existing.role !== 'member' ? existing.role : roleFor(user.email);
    const payload = {
      email: user.email,
      displayName: user.displayName || existing.displayName || (user.email ? user.email.split('@')[0] : 'Member'),
      memberId: memberId || null,
      role,
      createdAt: existing.createdAt || Date.now(),
      lastLoginAt: Date.now()
    };
    await ref.update(payload);
    return payload;
  }

  function saveSession(account, uid) {
    sessionStorage.setItem('xl_session', JSON.stringify({
      uid,
      email: account.email,
      name: account.displayName,
      role: account.role,
      memberId: account.memberId || null,
      ts: Date.now()
    }));
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem('xl_session') || 'null'); }
    catch { return null; }
  }

  function clearSession() { sessionStorage.removeItem('xl_session'); }

  // Sign in. Resolves with the session object.
  async function signIn(email, password) {
    const { auth, db } = init();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const account = await ensureAccountRecord(db, cred.user);
    saveSession(account, cred.user.uid);
    return getSession();
  }

  // Claim-existing-account signup. Requires a /members entry with matching email.
  // No orphan accounts are created — anyone without a member record must fill the form.
  async function signUp({ email, password, displayName }) {
    const { auth, db } = init();

    const memberId = await findMemberIdByEmail(db, email);
    if (!memberId) {
      const e = new Error('NO_MEMBER_RECORD');
      e.code = 'explab/no-member-record';
      throw e;
    }

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    if (displayName) {
      try { await cred.user.updateProfile({ displayName }); } catch {}
    }

    const account = {
      email,
      displayName: displayName || email.split('@')[0],
      memberId,
      role: roleFor(email),
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };
    await db.ref('accounts/' + cred.user.uid).set(account);
    saveSession(account, cred.user.uid);
    return getSession();
  }

  async function signOut() {
    try { const { auth } = init(); await auth.signOut(); } catch {}
    clearSession();
  }

  async function sendPasswordReset(email) {
    const { auth } = init();
    await auth.sendPasswordResetEmail(email);
  }

  // Subscribe to auth state. Refreshes /accounts on every sign-in.
  function onAuth(cb) {
    const { auth, db } = init();
    return auth.onAuthStateChanged(async user => {
      if (!user) { clearSession(); cb(null); return; }
      try {
        const account = await ensureAccountRecord(db, user);
        saveSession(account, user.uid);
        cb(getSession());
      } catch (e) {
        console.error('auth state refresh failed', e);
        cb(getSession()); // fall back to whatever we had
      }
    });
  }

  // Page guard. Redirects to login if not signed in. If adminOnly, redirects home
  // when a non-admin lands here. Resolves with the session once it's known.
  function requireAuth({ adminOnly = false } = {}) {
    const { auth } = init();
    return new Promise(resolve => {
      auth.onAuthStateChanged(async user => {
        if (!user) {
          const next = encodeURIComponent(location.pathname + location.search);
          location.replace('login.html?next=' + next);
          return;
        }
        const { db } = init();
        const account = await ensureAccountRecord(db, user);
        saveSession(account, user.uid);
        if (adminOnly && account.role !== 'admin' && account.role !== 'owner') {
          location.replace('index.html');
          return;
        }
        resolve(getSession());
      });
    });
  }

  global.ExplabAuth = {
    init, signIn, signUp, signOut, sendPasswordReset,
    onAuth, requireAuth, getSession, clearSession,
    roleFor, OWNER_EMAIL, ADMIN_EMAILS
  };
})(window);
