'use strict';

// Accesso all'API dell'account Stremio per leggere gli addon installati.
// Le credenziali non vengono mai salvate: si usano solo per ottenere l'authKey.

const API = process.env.STREMIO_API || 'https://api.strem.io/api';
// Percorsi candidati: si usa il primo che risponde in JSON e poi si ricorda.
const LINK_BASES = process.env.STREMIO_LINK_API
  ? [process.env.STREMIO_LINK_API]
  : ['https://link.stremio.com/api/v2', 'https://link.stremio.com/v2'];
let linkBase = null;
const SELF_ID = 'org.generi.organizzatore';

async function call(method, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (data.error) throw new Error(data.error.message || 'Errore API Stremio');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return data.result;
  } finally {
    clearTimeout(t);
  }
}

async function linkCall(method, params) {
  const bases = linkBase ? [linkBase] : LINK_BASES;
  let lastErr = null;
  for (const base of bases) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(`${base}/${method}?${new URLSearchParams(params)}`, { signal: ctrl.signal });
      const data = await r.json().catch(() => null);
      if (!data || (!data.result && !data.error)) { lastErr = new Error(`HTTP ${r.status}`); continue; }
      linkBase = base;
      if (data.error) { const e = new Error(data.error.message || 'Errore Stremio'); e.pending = true; throw e; }
      return data.result;
    } catch (e) {
      if (e.pending) throw e;
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error('Stremio non risponde (' + (lastErr ? lastErr.message : 'errore') + ')');
}

// Accesso tramite pagina Stremio (funziona anche con account Facebook/Apple):
// 1) linkCreate -> { code, link, qrcode }  2) l'utente apre link e conferma
// 3) linkRead(code) -> authKey (errore "pending" finché non conferma)
async function linkCreate() {
  const res = await linkCall('create', { type: 'Create' });
  if (!res || !res.code) throw new Error('Impossibile creare il codice di accesso');
  return res;
}

async function linkRead(code) {
  try {
    const res = await linkCall('read', { type: 'Read', code });
    return res && res.authKey ? res.authKey : null;
  } catch (e) {
    if (e.pending) return null;
    throw e;
  }
}

async function login(email, password) {
  const res = await call('login', { type: 'Login', email, password, facebook: false });
  if (!res || !res.authKey) throw new Error('Accesso non riuscito');
  return res.authKey;
}

// Restituisce gli addon installati che hanno almeno un catalogo film/serie,
// escludendo questo stesso addon (eviterebbe un giro infinito).
async function installedAddons(authKey) {
  const res = await call('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const list = (res && res.addons) || [];
  return list
    .filter(a => a && a.transportUrl && a.manifest && a.manifest.id !== SELF_ID)
    .map(a => ({
      name: a.manifest.name || a.manifest.id,
      url: a.transportUrl,
      catalogs: (a.manifest.catalogs || []).filter(c => c.type === 'movie' || c.type === 'series').length,
    }))
    .filter(a => a.catalogs > 0);
}

module.exports = { login, installedAddons, linkCreate, linkRead, SELF_ID };
