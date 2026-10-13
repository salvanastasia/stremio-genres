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
  process.env.TMDB_API = 'http://127.0.0.1:7103/tmdb';
  process.env.TMDB_API_KEY = 'chiave-test';
  process.env.CINEMETA_URL = 'http://127.0.0.1:7103/cinemeta';
  let collectionSet = null;
  const J = (res, o) => res.end(JSON.stringify(o));
  const api = await new Promise(r => {
    const s = http.createServer((req, res) => {
      let d = ''; req.on('data', c => d += c); req.on('end', () => {
        const body = JSON.parse(d || '{}');
        res.setHeader('content-type', 'application/json');
        if (req.url.startsWith('/tmdb/find/tt1000?')) {
          assert(req.url.includes('language=it-IT') && req.url.includes('api_key=chiave-test'));
          return res.end(JSON.stringify({ movie_results: [{ title: 'Film Zero', overview: 'Una trama in italiano.' }], tv_results: [] }));
        }
        if (req.url.startsWith('/tmdb/find/tt1001?')) return res.end(JSON.stringify({ movie_results: [{ title: 'Film Uno', overview: '' }] }));
        // --- schede (meta) ---
        const u = req.url.split('?')[0];
        if (u === '/tmdb/find/tt5000') return J(res, { movie_results: [{ id: 50, title: 'Il film', overview: 'Trama IT', poster_path: '/p.jpg' }] });
        if (u === '/tmdb/movie/50') return J(res, { id: 50, title: 'Il film', overview: 'Trama IT', poster_path: '/p.jpg', vote_average: 7.84, vote_count: 100, external_ids: { imdb_id: 'tt5000' }, images: { logos: [{ iso_639_1: 'en', file_path: '/logo-en.png' }, { iso_639_1: 'it', file_path: '/logo-it.png' }] },
          credits: { cast: [{ id: 32, name: 'Robin', character: 'Jenny', profile_path: null, order: 1 }, { id: 31, name: 'Tom Hanks', character: 'Forrest Gump', profile_path: '/t.jpg', order: 0 }] } });
        if (u === '/tmdb/person/31') {
          const it = req.url.includes('language=it-IT');
          return J(res, { id: 31, name: 'Tom Hanks', biography: it ? '' : 'English bio', birthday: '1956-07-09', profile_path: '/t.jpg' });
        }
        if (u === '/tmdb/person/31/movie_credits') return J(res, { cast: [
          { id: 13, title: 'Forrest Gump', character: 'Forrest', poster_path: '/fg.jpg', vote_count: 900, release_date: '1994-07-06' },
          { id: 14, title: 'Poco noto', character: 'X', poster_path: '/pn.jpg', vote_count: 5 },
          { id: 15, title: 'Documentario', character: 'Himself', poster_path: '/d.jpg', vote_count: 9999 },
          { id: 16, title: 'Senza poster', character: 'Y', poster_path: null, vote_count: 50 },
          { id: 13, title: 'Forrest Gump', character: 'Forrest', poster_path: '/fg.jpg', vote_count: 900 }] });
        if (u === '/cinemeta/meta/movie/tt5000.json') return J(res, { meta: { id: 'tt5000', type: 'movie', name: 'The Film', description: 'English plot', logo: 'en.png', imdbRating: '8.1', poster: 'cm.jpg' } });
        if (u === '/tmdb/find/tt6000') return J(res, { movie_results: [], tv_results: [{ id: 60, name: 'La serie' }] });
        if (u === '/tmdb/tv/60') return J(res, { id: 60, name: 'La serie', overview: 'Trama serie', external_ids: { imdb_id: 'tt6000' }, images: { logos: [] } });
        if (u === '/tmdb/tv/60/season/1') return J(res, { episodes: [{ episode_number: 1, name: 'Il pilota', overview: 'Ep IT' }, { episode_number: 2, name: 'Episodio 2', overview: '' }] });
        if (u === '/cinemeta/meta/series/tt6000.json') return J(res, { meta: { id: 'tt6000', type: 'series', name: 'The Show', logo: 'en.png', videos: [
          { id: 'tt6000:1:1', season: 1, episode: 1, name: 'Pilot', overview: 'EN1' },
          { id: 'tt6000:1:2', season: 1, number: 2, name: 'Second', overview: 'EN2' }] } });
        if (u === '/tmdb/tv/70') return J(res, { id: 70, name: 'Solo TMDB', overview: 'Solo qui', status: 'Ended', first_air_date: '2020-01-01', last_air_date: '2021-05-01', seasons: [{ season_number: 1 }], external_ids: { imdb_id: null } });
        if (u === '/tmdb/tv/70/season/1') return J(res, { episodes: [{ episode_number: 1, name: 'Uno', air_date: '2020-01-01' }] });
        if (u.startsWith('/cinemeta/')) { res.statusCode = 404; return J(res, {}); }
        if (u === '/api/addonCollectionSet') { collectionSet = body; return J(res, { result: { success: true } }); }
        if (req.url.startsWith('/tmdb/')) return res.end(JSON.stringify({ movie_results: [], tv_results: [] }));
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
    enrich: false, pages: 3, itTitle: false,
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

  const zero = sf.metas.find(m => m.id === 'tt1000');
  assert.equal(zero.description, 'Una trama in italiano.', 'trama tradotta');
  assert.equal(zero.name.startsWith('Film 0'), true, 'titolo invariato senza opzione');

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

  // Titoli in italiano attivi; trama vuota su TMDB -> resta quella originale
  const cfgIt = Buffer.from(JSON.stringify({ addons: ['http://127.0.0.1:7101/manifest.json'], movie: ['fantascienza', 'commedia'], series: [], enrich: false, itTitle: true })).toString('base64url');
  const itSf = await get(`/${cfgIt}/catalog/movie/gen.movie.fantascienza.json`);
  assert.equal(itSf.metas.find(m => m.id === 'tt1000').name, 'Film Zero');
  const itCo = await get(`/${cfgIt}/catalog/movie/gen.movie.commedia.json`);
  const uno = itCo.metas.find(m => m.id === 'tt1001');
  assert.equal(uno.name, 'Film Uno'); assert.equal(uno.description, undefined);
  const itSt = await get(`/${cfgIt}/status`);
  assert.equal(itSt.italian.translated, 2);

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

  // Scheda del titolo in italiano
  assert(man.resources.some(r => r.name === 'meta' && r.idPrefixes.includes('tt')), 'risorsa meta nel manifest');
  const mv = (await get(`/${cfgIt}/meta/movie/tt5000.json`)).meta;
  assert.equal(mv.name, 'Il film'); assert.equal(mv.description, 'Trama IT');
  assert.equal(mv.poster, 'https://image.tmdb.org/t/p/w500/p.jpg');
  assert.equal(mv.logo, 'https://image.tmdb.org/t/p/original/logo-it.png');
  assert.equal(mv.imdbRating, '8.1', 'voto IMDb di Cinemeta mantenuto');
  const sr = (await get(`/${cfgIt}/meta/series/tt6000.json`)).meta;
  assert.equal(sr.name, 'La serie'); assert.equal(sr.logo, undefined, 'logo inglese rimosso');
  assert.equal(sr.videos[0].title, 'Il pilota'); assert.equal(sr.videos[0].overview, 'Ep IT');
  assert.equal(sr.videos[0].id, 'tt6000:1:1', 'id episodi invariati per gli stream');
  assert.equal(sr.videos[1].name, 'Second', 'titolo generico "Episodio 2" non sostituito');
  assert.equal(sr.videos[1].overview, 'EN2');
  const tv = (await get(`/${cfgIt}/meta/series/tmdb:70.json`)).meta;
  assert.equal(tv.id, 'tmdb:70'); assert.equal(tv.releaseInfo, '2020-2021');
  assert.equal(tv.videos[0].id, 'tmdb:70:1:1'); assert.equal(tv.videos[0].title, 'Uno');
  const none = await fetch(`http://127.0.0.1:7100/${cfgIt}/meta/movie/tt9999.json`);
  assert.equal(none.status, 404);

  // Vedi cast: link nella scheda, griglia con foto tonde, scheda attore, filmografia
  const mUrl = `http://127.0.0.1:7100/${cfgIt}/manifest.json`;
  assert(man.catalogs.some(c => c.id === 'gen.cast'), 'catalogo cast nel manifest');
  const links = mv.links.filter(l => l.category === 'Cast');
  assert.equal(links[0].name, '👥 Vedi cast');
  assert.equal(links[0].url, `stremio:///discover/${encodeURIComponent(mUrl)}/movie/gen.cast?ref=movie-50`);
  assert.deepEqual(links.slice(1).map(l => l.name), ['Tom Hanks', 'Robin'], 'ordine del cast');
  assert(links[1].url.endsWith('/movie/gen.person.movie?person=31'));
  const castCat = await get(`/${cfgIt}/catalog/movie/gen.cast/ref=movie-50.json`);
  assert.equal(castCat.metas[0].name, 'Tom Hanks (Forrest Gump)');
  assert.equal(castCat.metas[0].id, 'gen.person:31'); assert.equal(castCat.metas[0].posterShape, 'square');
  assert(castCat.metas[0].poster.includes('mask=circle') && castCat.metas[0].poster.includes(encodeURIComponent('image.tmdb.org/t/p/w300/t.jpg')));
  assert.equal(castCat.metas[1].poster, undefined, 'senza foto niente immagine rotta');
  const person = (await get(`/${cfgIt}/meta/movie/gen.person:31.json`)).meta;
  assert.equal(person.name, 'Tom Hanks'); assert.equal(person.description, 'English bio', 'ripiego biografia inglese');
  assert.equal(person.releaseInfo, '1956');
  assert(person.links[0].url.endsWith('/movie/gen.person.movie?person=31'));
  assert(person.links[1].url.endsWith('/series/gen.person.series?person=31'));
  const filmo = await get(`/${cfgIt}/catalog/movie/gen.person.movie/person=31.json`);
  assert.deepEqual(filmo.metas.map(m => m.id), ['tmdb:13', 'tmdb:14'], 'popolari prima, niente "Himself", senza poster o doppioni');
  assert.equal(filmo.metas[0].releaseInfo, '1994');
  // "Vedi cast" nella lista degli stream (per i telecomandi TV)
  assert(man.resources.some(r => r.name === 'stream'), 'risorsa stream nel manifest');
  const st1 = await get(`/${cfgIt}/stream/movie/tt5000.json`);
  assert.equal(st1.streams.length, 1); assert.equal(st1.streams[0].title, 'Vedi cast con foto');
  assert.equal(st1.streams[0].androidTvUrl, `stremio:///discover/${encodeURIComponent(mUrl)}/movie/gen.cast?ref=movie-50`);
  const st2 = await get(`/${cfgIt}/stream/series/tt6000:1:2.json`);
  assert(st2.streams[0].externalUrl.endsWith('gen.cast?ref=tv-60'), 'episodi: cast della serie');
  const st3 = await get(`/${cfgIt}/stream/movie/tt9999.json`);
  assert.deepEqual(st3.streams, []);
  // disattivato da configurazione
  const cfgNoCast = Buffer.from(JSON.stringify({ addons: ['http://127.0.0.1:7101/manifest.json'], movie: ['commedia'], series: [], enrich: false, castPage: false })).toString('base64url');
  const manNo = await get(`/${cfgNoCast}/manifest.json`);
  assert(!manNo.catalogs.some(c => c.id === 'gen.cast'));
  assert(!manNo.resources.some(r => r.name === 'stream'), 'niente stream se cast disattivato');
  assert.deepEqual((await get(`/${cfgNoCast}/stream/movie/tt5000.json`)).streams, []);
  assert(!manNo.resources[1].idPrefixes.includes('gen.person:'), 'id persona non dichiarati') ;
  const mvNo = (await get(`/${cfgNoCast}/meta/movie/tt5000.json`)).meta;
  assert(!(mvNo.links || []).some(l => l.name === '👥 Vedi cast'));

  // Installa in cima sopra Cinemeta
  const myUrl = `http://127.0.0.1:7100/${cfgIt}/manifest.json`;
  const noKey = await post('/install-top', { manifestUrl: myUrl });
  assert.equal(noKey.status, 400);
  const top = await post('/install-top', { authKey: 'chiave-valida-123', manifestUrl: myUrl });
  assert.equal(top.status, 200, JSON.stringify(top.data));
  assert.equal(collectionSet.addons[0].transportUrl, myUrl);
  assert.equal(collectionSet.addons[0].manifest.id, 'org.generi.organizzatore');
  assert.equal(collectionSet.addons.filter(x => x.manifest.id === 'org.generi.organizzatore').length, 1, 'vecchia copia rimossa');
  assert.deepEqual(collectionSet.addons.slice(1).map(x => x.manifest.id), ['a', 's'], 'altri addon invariati');

  console.log('✅ Tutti i test superati');
  server.close(); a.close(); b.close(); api.close();
})().catch(e => { console.error('❌', e); process.exit(1); });
