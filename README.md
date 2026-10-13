# Generi – Organizzatore (addon Stremio)

Raccoglie i titoli dai **cataloghi di qualsiasi addon** che indichi e li riorganizza in righe per categoria sulla Home di Stremio (anche app TV):

- Azione - Film, Commedia - Film, Fantascienza - Film, Horror - Film, Thriller - Film…
- Fantascienza - Serie, Crime - Serie, Reality - Serie… (il " - Film" / " - Serie" finale lo aggiunge Stremio)
- In **Scopri** compaiono anche “Per genere” con il filtro genere.

## Come funziona

1. Legge il `manifest.json` di ogni addon sorgente e usa i suoi cataloghi film/serie (salta quelli di sola ricerca).
2. Scarica le prime N pagine di ogni catalogo; se l'addon offre un filtro “genere”, scarica anche le varianti per genere.
3. Riconosce il genere di ogni titolo (inglese, italiano, spagnolo, francese, generi composti tipo “Sci-Fi & Fantasy”, che finisce in entrambe le righe).
4. Per i titoli IMDb senza genere, lo recupera da Cinemeta (opzionale).
5. Unisce i duplicati tra addon diversi; un titolo presente in più cataloghi sale in cima (ordinamento “popolari”).
6. Tiene l'indice in cache 6 ore (ricostruito in background).

## Importazione automatica degli addon

Nella pagina di configurazione premi **Accedi con Stremio**: si apre la pagina di Stremio dove entri come fai di solito (anche con Facebook) e confermi. In alternativa puoi usare email e password. L'addon legge la lista degli addon installati e usa quelli con cataloghi (escludendo sé stesso e gli addon di soli stream). Email e password servono solo a ottenere la chiave di sessione e non vengono salvate.

Con **Sincronizzazione automatica** la chiave di sessione resta nel link dell'addon e la lista viene riletta a ogni aggiornamento (ogni 6 ore): gli addon che installi dopo entrano da soli. Il link in questo caso dà accesso al tuo account, quindi non va condiviso; per revocare la chiave fai logout da Stremio su tutti i dispositivi.

> In alternativa puoi incollare a mano i link manifest. Funzionano gli addon che hanno **cataloghi** (Cinemeta, TMDB, MDBList, Trakt, cataloghi streaming ecc.); quelli che forniscono solo stream non hanno elenchi di titoli.

## Avvio locale

```bash
npm start          # Node 18+, nessuna dipendenza
npm test           # test end-to-end con addon finti
```

Apri http://127.0.0.1:7000/configure. Stremio desktop accetta `http://127.0.0.1`, ma **l'app TV richiede un indirizzo https pubblico**.

## Pubblicazione (gratuita) per usarlo sulla TV

Va bene qualsiasi host Node con https, per esempio:

- **Render.com** → New › Web Service › collega il repo › Build `npm install` › Start `npm start`.
- **Railway / Fly.io / Koyeb** → stesso principio, porta letta da `PORT`.
- **Beamup** (hosting ufficiale della community Stremio): `npx beamup-cli`.

Poi apri `https://TUO-DOMINIO/configure`, scegli addon e categorie, premi **Installa in Stremio** dal telefono o dal PC: con lo stesso account, l'addon compare in automatico sulla app TV. Le righe appaiono nella Home; puoi riordinarle o nasconderle da Impostazioni › Addon.

## Trama e titoli in italiano

Le descrizioni di Cinemeta sono in inglese. Per averle in italiano l'addon usa TMDB:

1. Crea un account gratuito su https://www.themoviedb.org e vai in *Impostazioni › API* per ottenere la chiave (va bene sia la "Chiave API" v3 sia il "Token di accesso in lettura").
2. Su Railway apri il servizio › **Variables** › aggiungi `TMDB_API_KEY` con la chiave. Railway riavvia da solo.
3. Nella pagina di configurazione lascia attiva "Trama in italiano"; facoltativo "Titoli in italiano".

Con la chiave l'addon fornisce anche la **scheda completa del titolo** in italiano (titolo, trama, poster, logo, titoli e trame degli episodi) partendo da Cinemeta, così gli addon di stream continuano a funzionare. Perché Stremio la usi, l'addon deve stare **sopra Cinemeta**: nella pagina di configurazione, dopo "Accedi con Stremio", usa **Installa in cima (sopra Cinemeta)**.

Senza la chiave l'addon funziona normalmente con i testi originali. In `/status` il campo `italian` indica quanti titoli sono stati tradotti.

Variabile opzionale: `DEFAULT_ADDONS` (link separati da virgola proposti nella pagina di configurazione).

## Endpoint

| Percorso | Uso |
|---|---|
| `/configure` | pagina di configurazione |
| `/<config>/manifest.json` | link da installare |
| `/<config>/status` | diagnostica: titoli trovati per categoria |
