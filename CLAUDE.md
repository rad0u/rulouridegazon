# Rulouri de Gazon SRL — Aplicație digitalizare ferme

## Prezentare generală
Aplicație web pentru gestionarea celor 5 ferme de gazon ale SC Rulouri de Gazon SRL: Săbăreni, Medgidia, Holboca (Iași), Bobicești (Craiova), Timișoara. Fiecare fermă are o tarla împărțită în 3-4 parcele (gazon rustic, sport, sau în diverse stadii de pregătire).

## Utilizatori și roluri
- **Admin central (owner)** — vede și gestionează toate cele 5 ferme.
- **Admin de fermă** — vede și operează doar ferma proprie.

## Module

### 1. Ferme și parcele
- Listă de 5 ferme (fixe la lansare, structura permite adăugarea altora ulterior).
- Fiecare fermă are o hartă simplă: imagine statică (ex. captură din Google Earth) încărcată de admin, cu parcelele suprapuse ca poligoane clickabile.
- Fiecare parcelă are: nume/cod, tip gazon curent (rustic / sport / în pregătire), stadiu (dacă e în pregătire), suprafață (mp).
- Click pe parcelă → panou cu operațiuni disponibile + istoric operațiuni pe parcela respectivă.

### 2. Operațiuni pe parcelă
Tipuri de operațiuni: **Udat, Tuns, Aspirat, Suprainsămânțare, Fertilizare/Tratamente, Recoltare**.

Pentru fiecare operațiune introdusă: dată, tip, ore de lucru alocate, substanțe/materiale folosite + cantități (la Fertilizare/Tratamente și Suprainsămânțare — inclusiv sămânța folosită), note opționale.

Sistemul scade automat din stocul de substanțe la înregistrarea unei operațiuni de tip Fertilizare/Tratamente sau Suprainsămânțare.

### 3. Stoc substanțe (faza 1: doar consum, fără achiziții/furnizori)
- Listă substanțe: nume, unitate de măsură, cantitate curentă în stoc.
- Stoc inițial introdus manual de admin central.
- La fiecare operațiune de Fertilizare/Tratamente, stocul scade automat cu cantitatea folosită.
- Vizualizare stoc curent per substanță (per fermă și/sau centralizat).
- Istoric consum: substanță, cantitate, dată, fermă, parcelă, operațiune asociată.

### 4. Recoltare zilnică
- Înregistrare zilnică: fermă, parcelă, tip gazon recoltat, suprafață recoltată (mp), dată.
- Raport agregat: mp recoltați pe zi/săptămână/lună, per fermă și per tip gazon.

### 5. Livrări
- Înregistrare livrare: fermă, dată, cantitate livrată (mp), client (câmp text liber, fără fișă de client în faza 1), euro-paleți vânduți, euro-paleți returnați.
- Sold paleți (vânduți - returnați), la nivel global.

### 6. Rapoarte / Dashboard
- Consum substanțe (per fermă, per perioadă).
- Stoc curent substanțe.
- mp recoltați (per fermă, tip gazon, perioadă).
- Situație paleți (vânduți vs. returnați).
- Ore de muncă alocate per operațiune/fermă.
- Dashboard central (toate cele 5 ferme) pentru admin central; vedere per-fermă pentru admin de fermă.

## Fluxuri cheie
1. Admin de fermă deschide harta fermei → click pe parcelă → alege tip operațiune → completează detalii (ore, substanțe, cantități) → salvează.
2. Admin de fermă introduce zilnic: mp recoltați + tip gazon; cantitate livrată + paleți vânduți/returnați.
3. Admin central vede dashboard centralizat pe toate cele 5 ferme și poate intra pe oricare fermă individual, cu aceleași drepturi ca adminul fermei respective.

## Rămas pentru faza 2 (nu se implementează inițial)
- Tracking paleți per client (sold istoric per client, nu doar global).
- Modul achiziții/furnizori pentru substanțe.
- Alerte stoc minim.
- Rapoarte financiare/costuri.
- Fișe complete de clienți / comenzi.

## Stack tehnic recomandat
- **Frontend + backend:** Next.js (React).
- **Bază de date + autentificare + storage imagini hărți:** Supabase (Postgres).
- **Deploy:** Vercel, cu domeniul propriu conectat prin DNS.

## Model de date (schiță inițială)
- `ferme` (id, nume, locație)
- `parcele` (id, ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta)
- `operatiuni` (id, parcela_id, tip, data, ore_lucru, note, user_id)
- `operatiuni_substante` (id, operatiune_id, substanta_id, cantitate)
- `substante` (id, nume, unitate_masura, stoc_curent)
- `recoltari` (id, parcela_id, data, tip_gazon, suprafata_mp)
- `livrari` (id, ferma_id, data, client, cantitate_mp, paleti_vanduti, paleti_returnati)
- `utilizatori` (id, nume, rol, ferma_id — null dacă e admin central)

## Modul Flotă auto (mașini de pasageri) — foi de parcurs

Adăugat 2026-08-27. Complet separat conceptual de modulul utilaje/combustibil
(fermă, tractor, DUT-E) — flotă centrală de mașini de pasageri, fără senzor
de combustibil, scop unic: foi de parcurs lunare + geofencing/alerte viteză.

### Hardware
- **Tracker GPS**: Teltonika FMC130 (25 bucăți achiziționate + 25 SIM-uri de
  date). Fără senzor de combustibil — doar poziție GPS + stare contact
  (ignition) + viteză.
- Configurare identică cu utilajele: dispozitiv nou în **același Traccar**
  (http://135.181.45.175/), Identifier = IMEI.

### Roluri
- **Șofer** (`utilizatori.rol = 'sofer'`) — vede/completează doar cursele
  proprii (`curse.sofer_id = auth.uid()`), din mobil. Nu are `ferma_id`.
- **Admin general** — gestionează mașinile, validează cursele, generează
  foile de parcurs, definește zonele de geofencing.

### Flux
1. Șoferul urcă în mașină → contactul pornește → `sync-traccar-masini`
   (cron, 5 min) detectează automat o cursă nouă (segment ignition on/off,
   la fel ca orele de funcționare de la utilaje).
2. Km parcurși = calculați automat din traseul GPS (haversine cumulat), NU
   introduși manual.
3. Șoferul completează doar **scopul cursei** din `/curse` (mobil) — nu
   pornește/oprește nimic manual.
4. Admin validează cursele completate din `/curse` (desktop) → generează
   foaia de parcurs lunară din `/foi-parcurs` (tabel printabil / PDF prin
   `window.print()`).
5. Geofencing (`/geofences`) + alerte de viteză (`viteza_limita_kmh` per
   mașină) — detectate în același job cron, afișate în `/alerte`.

### Model de date
- `masini` (id, nume, numar_inmatriculare, marca_model, traccar_device_id,
  sofer_implicit_id → utilizatori, viteza_limita_kmh, activ)
- `masini_pozitii` (id, masina_id, data_ora, latitudine, longitudine,
  viteza_kmh, contact, sursa)
- `curse` (id, masina_id, sofer_id, data_ora_start, data_ora_stop, km, scop,
  status: detectata → completata → validata, note)
- `geofences` (id, nume, poligon GeoJSON — același format ca
  `parcele.poligon_harta`, tip_alerta: intrare/iesire/ambele, activ)
- `alerte` (id, masina_id, tip: viteza/intrare_zona/iesire_zona, geofence_id,
  viteza_masurata, viteza_limita, data_ora, latitudine, longitudine, vazuta)

Detalii complete de implementare, decizii și pași manuali rămași: vezi
`NOTES.md`, secțiunea „Flotă auto".
