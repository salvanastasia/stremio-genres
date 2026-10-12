'use strict';

// Accesso all'API dell'account Stremio per leggere gli addon installati.
// Le credenziali non vengono mai salvate: si usano solo per ottenere l'authKey.

const API = process.env.STREMIO_API || 'https://api.strem.io/api';
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

module.exports = { login, installedAddons, SELF_ID };
