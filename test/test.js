'use strict';
// Test end-to-end: due addon finti + server reale, nessuna rete esterna.
const http = require('http');
const assert = require('assert');

function fakeAddon(port, manifest, catalogFn) {
  return new Promise(r => {
    const s = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/manifest.json') return res.end(JSON.stringify(manifest));
      const m = /^\/catalog\/(\w+)\/([^/]+?)(?:\/(.+))?\.json$/.exec(req.url);
      if (!m) { res.statusCode = 404; return res.end('{}'); }
      const extra = Object.fromEntries((m[3] || '').split('&').filter(Boolean).map(p => p.split('=').map(decodeURIComponent)));
      res.end(JSON.stringify({ metas: catalogFn(m[1], m[2], extra) }));
    }).listen(port, () => r(s));
  });
}

(async () => {
  // Addon A: generi in inglese dentro i meta, 150 film (2 pagine)
  const films = Array.from({ length: 150 }, (_, i) => ({
    id: `tt${1000 + i}`, type: 'movie', name: `Film ${i}`, imdbRating: String((i % 10) + 0.5),
    genres: i % 3 === 0 ? ['Sci-Fi', 'Action'] : i % 3 === 1 ? ['Comedy'] : ['Horror', 'Thriller'],
  }));
  const a = await fakeAddon(7101, {
    id: 'a', version: '1', name: 'A', resources: ['catalog'], types: ['movie', 'series'],
    catalogs: [
      { type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'skip' }] },
      { type: 'movie', id: 'search', name: 'Cerca', extra: [{ name: 'search', isRequired: true }] },
      { type: 'series', id: 'tv', name: 'TV' },
    ],
  }, (type, id, extra) => {
    if (type === 'movie' && id === 'top') { const s = +extra.skip || 0; return films.slice(s, s + 100); }
    if (type === 'series') return [{ id: 'tt9001', type: 'series', name: 'Serie SF', genres: ['Sci-Fi & Fantasy'] }];
    return [];
  });

  // Addon B: nessun genere nei meta, ma filtro genere in italiano; un duplicato di A
  const b = await fakeAddon(7102, {
    id: 'b', version: '1', name: 'B', resources: ['catalog'], types: ['movie'],
    catalogs: [{ type: 'movie', id: 'it', name: 'IT', extra: [{ name: 'genre', isRequired: true, options: ['Fantascienza', 'Commedia', 'Varie'] }] }],
  }, (type, id, extra) => {
    if (extra.genre === 'Fantascienza') return [{ id: 'tt1000', type: 'movie', name: 'Film 0 (dup)' }, { id: 'kitsu:5', type: 'movie', name: 'Solo B' }];
    if (extra.genre === 'Commedia') return [{ id: 'tt7777', type: 'movie', name: 'Commedia B' }];
    return [];
  });

  // Finta API account Stremio
  process.env.STREMIO_API = 'http://127.0.0.1:7103/api';
  process.env.STREMIO_LINK_API = 'http://127.0.0.1:7103/link/v2';
  let reads = 0;
  const api = await new Promise(r => {
    const s = http.createServer((req, res) => {
      let d = ''; req.on('data', c => d += c); req.on('end', () => {
        const body = JSON.parse(d || '{}');
        res.setHeader('content-type', 'application/json');
        if (req.url === '/link/v2/create?type=Create') return res.end(JSON.stringify({ result: { code: 'ABC12', link: 'https://www.stremio.com/link?code=ABC12', qrcode: 'iVBORw0KGgo=' } }));
        if (req.url === '/link/v2/read?type=Read&code=ABC12') {
          reads++;
          if (reads < 2) return res.end(JSON.stringify({ error: { message: 'Not confirmed', code: 1 } }));
          return res.end(JSON.stringify({ result: { authKey: 'chiave-valida-123' } }));
        }
        if (req.url === '/api/login') {
          if (body.email === 'io@test.it' && body.password === 'ok') return res.end(JSON.stringify({ result: { authKey: 'chiave-valida-123' } }));
          return res.end(JSON.stringify({ error: { message: 'Password errata' } }));
        }
        if (req.url === '/api/addonCollectionGet' && body.authKey === 'chiave-valida-123') {
          return res.end(JSON.stringify({ result: { addons: [
            { transportUrl: 'http://127.0.0.1:7101/manifest.json', manifest: { id: 'a', name: 'A', catalogs: [{ type: 'movie', id: 'top' }] } },
            { transportUrl: 'http://127.0.0.1:7100/xyz/manifest.json', manifest: { id: 'org.generi.organizzatore', name: 'Generi', catalogs: [{ type: 'movie', id: 'x' }] } },
            { transportUrl: 'http://stream.only/manifest.json', manifest: { id: 's', name: 'Solo stream', catalogs: [] } },
          ] } }));
        }
        res.end(JSON.stringify({ error: { message: 'Sessione non valida' } }));
      });
    }).listen(7103, () => r(s));
  });

  const { server } = require('../server');
  await new Promise(r => server.listen(7100, r));
  const get = async p => (await fetch('http://127.0.0.1:7100' + p)).json();

  const cfg = Buffer.from(JSON.stringify({
    addons: ['http://127.0.0.1:7101/manifest.json', 'stremio://127.0.0.1:7102/manifest.json'.replace('stremio://', 'http://')],
    movie: ['fantascienza', 'commedia', 'horror', 'thriller', 'azione'],
    series: ['fantascienza', 'fantasy'],
    enrich: false, pages: 3,
  })).toString('base64url');

  const man = await get(`/${cfg}/manifest.json`);
  assert.equal(man.behaviorHints.configurationRequired, false);
  const names = man.catalogs.map(c => c.name);
  console.log('Cataloghi:', names.join(' | '));
  assert(names.includes('Fantascienza') && names.includes('Fantasy') && names.includes('Per genere'));
  assert(!names.some(n => /^(Film|Serie)\b/.test(n)), 'niente prefisso Film/Serie');

  const sf = await get(`/${cfg}/catalog/movie/gen.movie.fantascienza.json`);
  const ids = sf.metas.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length, 'nessun duplicato');
  assert(ids.includes('kitsu:5'), 'titolo classificato tramite filtro genere di B');
  assert.equal(ids[0], 'tt1000', 'titolo presente in 2 addon in cima (popolari)');
  assert.equal(ids.length, 51, '50 SF da A + 1 solo da B');

  const comm = await get(`/${cfg}/catalog/movie/gen.movie.commedia.json`);
  assert.equal(comm.metas.length, 51);
  const p2 = await get(`/${cfg}/catalog/movie/gen.movie.horror/skip=100.json`);
  assert.equal(p2.metas.length, 0);

  const disc = await get(`/${cfg}/catalog/movie/gen.movie.all/genre=Thriller.json`);
  assert.equal(disc.metas.length, 50);

  const ser = await get(`/${cfg}/catalog/series/gen.series.fantasy.json`);
  assert.deepEqual(ser.metas.map(m => m.id), ['tt9001'], '"Sci-Fi & Fantasy" va in entrambe');

  const st = await get(`/${cfg}/status`);
  console.log('Stato:', JSON.stringify(st));

  const bare = await get('/manifest.json');
  assert.equal(bare.behaviorHints.configurationRequired, true);

  const html = await (await fetch('http://127.0.0.1:7100/configure')).text();
  assert(html.includes('Fantascienza') && !html.includes('__GENRES__'));

  // Importazione dall'account
  const post = async (p, body) => { const r = await fetch('http://127.0.0.1:7100' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  const bad = await post('/import', { email: 'io@test.it', password: 'no' });
  assert.equal(bad.status, 400); assert.equal(bad.data.error, 'Password errata');
  const ok = await post('/import', { email: 'io@test.it', password: 'ok' });
  assert.equal(ok.data.authKey, 'chiave-valida-123');
  assert.deepEqual(ok.data.addons.map(x => x.name), ['A'], 'esclusi sé stesso e addon senza cataloghi');

  // Accesso tramite pagina Stremio (Facebook): prima in attesa, poi chiave + addon
  const lc = await get('/link/create');
  assert.equal(lc.code, 'ABC12'); assert(lc.link.includes('ABC12'));
  const r1 = await get('/link/read?code=ABC12');
  assert.equal(r1.pending, true);
  const r2 = await get('/link/read?code=ABC12');
  assert.equal(r2.authKey, 'chiave-valida-123');
  assert.deepEqual(r2.addons.map(x => x.name), ['A']);
  const badCode = await fetch('http://127.0.0.1:7100/link/read?code=../x');
  assert.equal(badCode.status, 400);

  // Sincronizzazione automatica: nessun link manuale, solo authKey
  const cfgSync = Buffer.from(JSON.stringify({ authKey: 'chiave-valida-123', movie: ['commedia'], series: [], enrich: false })).toString('base64url');
  const syncCat = await get(`/${cfgSync}/catalog/movie/gen.movie.commedia.json`);
  assert.equal(syncCat.metas.length, 50, 'titoli presi dagli addon installati');
  const syncSt = await get(`/${cfgSync}/status`);
  assert.deepEqual(syncSt.sourceNames, ['A']);

  console.log('✅ Tutti i test superati');
  server.close(); a.close(); b.close(); api.close();
})().catch(e => { console.error('❌', e); process.exit(1); });
