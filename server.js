'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GENRES, ORDER, DEFAULTS, LABEL_TO_KEY, norm } = require('./lib/genres');
const { getIndex, PAGE } = require('./lib/aggregator');
const account = require('./lib/stremio-account');
const pkg = require('./package.json');

const PORT = process.env.PORT || 7000;

// Addon usati se l'utente non ne indica (Cinemeta: cataloghi ufficiali di Stremio).
const DEFAULT_ADDONS = (process.env.DEFAULT_ADDONS || 'https://v3-cinemeta.strem.io/manifest.json')
  .split(',').map(s => s.trim()).filter(Boolean);

// ---------- configurazione (codificata nell'URL, base64url JSON) ----------

function parseConfig(str) {
  let raw = {};
  if (str) {
    try { raw = JSON.parse(Buffer.from(str, 'base64url').toString('utf8')); }
    catch { try { raw = JSON.parse(decodeURIComponent(str)); } catch { raw = {}; } }
  }
  const pick = (list, type) => (Array.isArray(list) ? list : DEFAULTS[type]).filter(k => GENRES[k] && ORDER[type].includes(k));
  const authKey = typeof raw.authKey === 'string' && /^[\w.-]{8,200}$/.test(raw.authKey) ? raw.authKey : null;
  const addons = (Array.isArray(raw.addons) && raw.addons.length ? raw.addons : authKey ? [] : DEFAULT_ADDONS)
    .filter(u => typeof u === 'string' && /^(https?|stremio):\/\//i.test(u)).slice(0, 25);
  return {
    addons,
    movie: pick(raw.movie, 'movie'),
    series: pick(raw.series, 'series'),
    pages: Math.min(Math.max(parseInt(raw.pages, 10) || 3, 1), 10),
    sort: ['popular', 'rating', 'year', 'name'].includes(raw.sort) ? raw.sort : 'popular',
    enrich: raw.enrich !== false,
    enrichLimit: Math.min(Math.max(parseInt(raw.enrichLimit, 10) || 300, 0), 1500),
    useGenreFilters: raw.useGenreFilters !== false,
    browse: raw.browse !== false,
    authKey,
  };
}

function cfgKey(cfg) {
  return crypto.createHash('sha1').update(JSON.stringify(cfg)).digest('hex');
}

// ---------- manifest ----------

function buildManifest(cfg, configured) {
  const catalogs = [];
  // Stremio aggiunge già il tipo in coda ("Animazione - Film"), quindi qui solo il genere.

  for (const type of ['movie', 'series']) {
    // Una riga per genere sulla Home (Board)
    for (const k of ORDER[type]) {
      if (!cfg[type].includes(k)) continue;
      catalogs.push({
        type,
        id: `gen.${type}.${k}`,
        name: GENRES[k].label,
        extra: [{ name: 'skip', isRequired: false }],
      });
    }
    // Un catalogo unico con filtro "genere", comodo in Scopri (Discover) sulla TV
    if (cfg.browse && cfg[type].length) {
      catalogs.push({
        type,
        id: `gen.${type}.all`,
        name: 'Per genere',
        extra: [
          { name: 'genre', isRequired: true, options: cfg[type].map(k => GENRES[k].label) },
          { name: 'skip', isRequired: false },
        ],
      });
    }
  }

  return {
    id: 'org.generi.organizzatore',
    version: pkg.version,
    name: 'Generi – Organizzatore',
    description: 'Riorganizza i titoli di tutti i tuoi addon in categorie: Film › Fantascienza, Commedia, Thriller, Horror… e lo stesso per le Serie.',
    logo: 'https://dl.strem.io/addon-logo.png',
    resources: ['catalog'],
    types: ['movie', 'series'],
    idPrefixes: [],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: !configured },
  };
}

// ---------- catalogo ----------

function parseExtra(str) {
  const out = {};
  if (!str) return out;
  for (const part of str.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

async function handleCatalog(cfg, type, id, extra) {
  const m = /^gen\.(movie|series)\.([a-z]+)$/.exec(id);
  if (!m || m[1] !== type) return { metas: [] };
  let key = m[2];
  if (key === 'all') {
    key = LABEL_TO_KEY.get(norm(extra.genre || ''));
    if (!key) return { metas: [] };
  }
  if (!cfg[type].includes(key)) return { metas: [] };

  const { index } = await getIndex(cfgKey(cfg), cfg);
  const list = index[type][key] || [];
  const skip = Math.max(parseInt(extra.skip, 10) || 0, 0);
  return { metas: list.slice(skip, skip + PAGE) };
}

// ---------- server HTTP (nessuna dipendenza esterna) ----------

function send(res, status, body, type = 'application/json; charset=utf-8', maxAge = 0) {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': maxAge ? `public, max-age=${maxAge}, stale-while-revalidate=86400` : 'no-cache',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

const configureHtml = fs.readFileSync(path.join(__dirname, 'public', 'configure.html'), 'utf8')
  .replace('__GENRES__', JSON.stringify(Object.fromEntries(Object.entries(GENRES).map(([k, g]) => [k, g.label]))))
  .replace('__ORDER__', JSON.stringify(ORDER))
  .replace('__DEFAULTS__', JSON.stringify(DEFAULTS))
  .replace('__DEFAULT_ADDONS__', JSON.stringify(DEFAULT_ADDONS));

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');

  // Accesso tramite pagina Stremio (anche per chi entra con Facebook)
  if (url.pathname === '/link/create') {
    try {
      const r = await account.linkCreate();
      return send(res, 200, { code: r.code, link: r.link, qrcode: r.qrcode });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (url.pathname === '/link/read') {
    const code = url.searchParams.get('code') || '';
    if (!/^[\w-]{3,64}$/.test(code)) return send(res, 400, { error: 'Codice non valido' });
    try {
      const authKey = await account.linkRead(code);
      if (!authKey) return send(res, 200, { pending: true });
      const addons = await account.installedAddons(authKey);
      return send(res, 200, { authKey, addons });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }

  // Importa gli addon dall'account Stremio. Le credenziali non vengono salvate né registrate.
  if (req.method === 'POST' && url.pathname === '/import') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      let authKey = typeof body.authKey === 'string' ? body.authKey.trim() : '';
      if (!authKey) {
        if (!body.email || !body.password) return send(res, 400, { error: 'Inserisci email e password' });
        authKey = await account.login(String(body.email), String(body.password));
      }
      const addons = await account.installedAddons(authKey);
      return send(res, 200, { authKey, addons });
    } catch (e) {
      return send(res, 400, { error: e.message || 'Importazione non riuscita' });
    }
  }

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  try {
    // /  e  /configure  e  /<cfg>/configure
    if (!parts.length || parts[parts.length - 1] === 'configure') {
      return send(res, 200, configureHtml, 'text/html; charset=utf-8');
    }

    // config opzionale come primo segmento
    let cfgStr = '';
    if (parts[0] !== 'manifest.json' && parts[0] !== 'catalog' && parts[0] !== 'status') cfgStr = parts.shift();
    const cfg = parseConfig(cfgStr);

    if (parts[0] === 'manifest.json') return send(res, 200, buildManifest(cfg, !!cfgStr), undefined, 3600);

    if (parts[0] === 'status') {
      const data = await getIndex(cfgKey(cfg), cfg);
      const counts = {};
      for (const t of ['movie', 'series']) for (const [k, v] of Object.entries(data.index[t])) counts[`${t}.${k}`] = v.length;
      return send(res, 200, { ...data.stats, counts });
    }

    if (parts[0] === 'catalog' && parts.length >= 3) {
      const type = parts[1];
      let id = parts[2];
      let extraStr = parts[3] || '';
      if (!parts[3]) id = id.replace(/\.json$/, ''); else extraStr = extraStr.replace(/\.json$/, '');
      const body = await handleCatalog(cfg, type, id, parseExtra(extraStr));
      return send(res, 200, body, undefined, 3600);
    }

    send(res, 404, { err: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { err: 'errore interno', metas: [] });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Addon "Generi" su http://127.0.0.1:${PORT}/configure`));
}

module.exports = { server, parseConfig, buildManifest };
