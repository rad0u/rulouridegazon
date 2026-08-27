# Note de proiect — decizii, status, context tehnic

Acest fișier e memorie externă pentru proiect: decizii importante, ce s-a construit
deja, și de ce s-au ales anumite soluții. Scopul e ca informația să supraviețuiască
chiar dacă o conversație cu Claude se pierde sau se rezumă. Se actualizează pe măsură
ce apar decizii noi — nu e nevoie să reconstruim contextul din memorie de fiecare dată.

Ultima actualizare: 2026-08-22.

---

## 1. Status general

Aplicația e construită și în producție:
- Cod sursă: repo pe GitHub (legat la contul GitHub al lui Radu).
- Găzduire/deploy: Vercel (plan Hobby), auto-deploy la fiecare push pe branch-ul `main`.
- URL live: https://rulouridegazon.vercel.app/
- Bază de date + autentificare + storage: Supabase (proiect `oyxnjyvproazqhyfgyet`).

Fluxul de cod: se editează local → `git add` / `git commit` / `git push` (din Terminal,
pe Mac-ul lui Radu, nu din sandbox-ul Claude) → GitHub primește codul → Vercel detectează
push-ul și rebuild-uiește automat site-ul live. Variabilele de mediu (cheile Supabase)
sunt setate direct în Vercel → Settings → Environment Variables, nu în cod.

## 2. Module implementate (toate cele 17 task-uri inițiale — completate)

- Login clasic + logout; redirect automat: admin_ferma → direct pe tarlaua fermei lui;
  admin_central → dashboard cu toate fermele.
- Hartă interactivă per fermă: **satelit real (Leaflet + Esri World Imagery)**, parcele
  desenate ca poligoane cu coordonate GPS reale, click-abile direct pe hartă (vezi
  secțiunea 5b — schimbat 2026-08-22, înlocuiește imaginea statică încărcată manual).
- Panou parcelă: descriere (nume, tip gazon, suprafață — editabile doar de admin central),
  istoric operațiuni, formular de înregistrare operațiune nouă.
- 6 tipuri de operațiuni: Udat, Tuns, Aspirat, Tratamente foliare, Fertilizare solidă,
  Recoltare. Ore de lucru: număr întreg, 0–8. La Tratamente foliare și Fertilizare
  solidă se înregistrează substanțe + cantități, iar stocul scade automat.
- Ecran `/substante`: stoc curent per substanță.
- Ecran `/utilizatori` (admin central): creare conturi noi (email, parolă, rol, fermă)
  direct din aplicație, fără SQL manual — printr-o Edge Function securizată.
- Restricții de editare (hartă, poligoane, descriere parcelă) impuse **la nivel de bază
  de date** (trigger + RLS), nu doar ascunse în interfață — deci nu pot fi ocolite din
  afara aplicației.
- Aplicație responsive pe mobil pentru fluxul de teren (login → tarla → parcelă →
  operațiune), gândită să fie utilizabilă de pe telefon, dintr-un utilaj agricol în
  mișcare: butoane mari, un singur ecran, fără zoom accidental pe iOS.
- Link „Tracking" în meniu (doar admin central) → deschide serverul Traccar extern
  într-un tab nou (http://135.181.45.175/). Nu e integrat ca iframe — problemă de
  cookie-uri/sesiune cross-origin, decizie: link extern e suficient pentru acum.

## 3. Convenții de denumire — atenție, eticheta din interfață ≠ valoarea din bază de date

Ca să nu trebuiască migrare de date la fiecare schimbare de denumire, valorile din
baza de date au rămas neschimbate, doar eticheta afișată în interfață s-a schimbat:

| Valoare în bază de date   | Etichetă afișată în aplicație |
|---------------------------|-------------------------------|
| `Suprainsamantare`        | **Tratamente foliare**        |
| `Fertilizare/Tratamente`  | **Fertilizare solidă**        |

Definite în `lib/operatiuniTypes.ts` (`LABEL_OPERATIUNE`). Dacă se mai cere o
redenumire, se schimbă doar acolo — nu în baza de date.

## 4. Decizii cheie de arhitectură

- **De ce toate paginile sunt „client components" (`'use client'`)**: paginile citesc
  date din Supabase folosind sesiunea browserului (utilizatorul logat). Dacă am fi
  folosit Server Components, cererile ar fi mers fără sesiunea utilizatorului și
  regulile de securitate (RLS) ar fi blocat accesul la date. Deci fetch-ul de date se
  face din browser, nu pe server.
- **Coordonate poligoane parcele**: stocate ca fracții 0–1 (nu pixeli), independente de
  rezoluția imaginii. Așa funcționează corect indiferent cât de mare/mică e imaginea
  hărții încărcate.
- **Securitate la nivel de bază de date**: orice restricție importantă (cine poate edita
  harta, poligoanele, descrierea parcelei) e impusă prin trigger-e SQL / RLS în Supabase,
  nu doar ascunsă în interfață. Cerință explicită: chiar dacă cineva ocolește aplicația
  și lovește direct API-ul Supabase, restricțiile tot se aplică.

## 5. Hardware GPS / combustibil — decizii

### Pilot monitorizare combustibil (utilaje agricole) — LIVE (2026-08-18)
- **Tracker GPS**: Teltonika FMC125 (LTE, dual-SIM, RS232 **și** RS485, fuel monitoring,
  acumulator back-up inclus în cutie).
- **Senzor combustibil (pilot)**: Technoton DUT-E 232 (senzor digital RS232, capacitiv, 1%
  precizie). Link produs: https://e-shop.jv-technoton.com/product/dut-e-232/
- **Interfață configurare senzor**: SK DUT-E (nu S6 SK — acela e pentru altă linie de
  produse, cu conector SC). Link: https://e-shop.jv-technoton.com/product/sk-dut-e/
  Necesită Service DUT-E software v6+ (v3.26 nu se conectează la unitățile noastre).
- Pilot montat pe utilajul din Săbăreni (IMEI 862272083141426), funcțional end-to-end:
  FMC125 (RS232 → mod LLS, Operand Monitoring) → Traccar → atribut **`io201`** →
  Edge Function `sync-traccar-fuel` (cron la 15 min) → tabela `combustibil_citiri`.
  Confirmat cu date reale în producție.
- Server Traccar (self-hosted): http://135.181.45.175/. Dispozitivele se identifică în
  Traccar după IMEI (câmpul „Identifier").
- **Important**: `io201` e valoarea BRUTĂ a senzorului („kvants"), nu litri. Devine litri
  reali abia după calibrarea DUT-E pe rezervorul real (Service DUT-E → tabel de tarare +
  „Output message” = „Volume of fuel (L)”). În aplicație, coloana „Combustibil” din
  `/utilaje` trece automat de la afișare brută la litri reali în momentul în care se
  completează `utilaje.tanc_capacitate_litri` pentru utilajul respectiv — fără cod nou.
- Conector fizic: unitatea DUT-E fizică are conector rotund cu 5 pini (generație mai
  veche); cablurile din kitul SK DUT-E pentru 232/485/KLIN au conector oval cu 6 pini
  (generație nouă) — nu se potrivesc mecanic. Doar cablul „CAN” are conector rotund, dar
  cablajul lui intern nu duce semnalele 232R/232T. Soluție folosită: cablare directă pe
  firele libere ale senzorului (portocaliu/maro/albastru/alb/negru), conform fișei tehnice
  oficiale a senzorului (nu manualul generic, care are o eroare de culoare pe firul TX).

### Extindere la toată flota (36 de utilaje, recensământ 2026-08-18)
- 36 de utilaje în total, din care **8 cu rezervor dublu** (rezervoare interconectate
  între ele — vase comunicante; doar unul are acces de umplere, celălalt e complet închis)
  și 28 cu un singur rezervor.
- **Decizie: 1 sondă per utilaj, chiar și la cele cu rezervor dublu — dar de revizuit
  dacă apar anomalii.** Rezervoarele interconectate se echilibrează suficient de repede
  încât o sondă montată în rezervorul cu acces la umplere (singurul unde se poate fizic
  introduce proba) ar trebui să reflecte corect nivelul total al sistemului —
  consumul/furtul din oricare parte scade nivelul combinat, nu doar local. Rămâne un risc
  mecanic (înfundarea/blocarea tubului de interconectare, nedetectabilă direct din
  citire). **Decizia nu e definitivă**: după montaj, dacă citirile de la utilajele cu
  rezervor dublu arată anomalii (salturi neexplicate, valori care nu se potrivesc cu
  alimentările/consumul real), se decide separat, per caz, instalarea unei a doua sonde.
  FMC125 are deja portul RS485 necesar pentru asta (suportă multi-drop, până la 5 sonde),
  deci upgrade-ul ulterior nu necesită schimbarea trackerului.
- **Standardizare senzor: DUT-E 485** (nu 232) pentru toate instalările noi — decizie
  luată din considerente de **consecvență** (nu de necesitate imediată — cu 1 sondă/utilaj
  nu e nevoie de multi-drop acum), pentru că nu există diferență de preț față de 232, iar
  RS485 e mai rezistent la interferențe electrice (semnal diferențial, relevant lângă
  motor/alternator). Link: https://e-shop.jv-technoton.com/product/dut-e-485/. Pilotul
  (Săbăreni) rămâne pe DUT-E 232 — deja montat și funcțional, nu se schimbă.
- FMC125 are oricum ambele porturi, RS232 și RS485 — alegerea senzorului 232 vs. 485 e
  independentă de tracker, doar de tipul de cablare/interfață dorit.
- **Listă de comandă rămasă** (pilotul, 1x FMC125 + 1x DUT-E 232, e deja acoperit):
  - 35x Teltonika FMC125.
  - 35x DUT-E 485 (1 per utilaj, inclusiv cele cu rezervor dublu).
  - SK DUT-E (kitul de configurare) deja deținut, reutilizabil pentru toate sondele — de
    luat în calcul un al doilea kit doar dacă se configurează sonde în paralel, în locații
    diferite.
- Pas rămas: pe măsură ce vine hardware-ul, se montează și se populează
  `utilaje.traccar_device_id` (IMEI) pentru fiecare utilaj în tabela `utilaje`.

### Rezervor central pe fermă (2026-08-21)
Cerință: fiecare fermă are un rezervor mare de motorină; admin central introduce în
aplicație capacitatea rezervorului și cantitatea la fiecare realimentare de la furnizor;
aplicația scade automat consumul zilnic al utilajelor fermei și afișează cât a mai rămas.

- **Schema** (`supabase/schema-rezervor-central.sql`, aplicată): `ferme` capătă
  `rezervor_capacitate_litri`, `rezervor_nivel_initial_litri`, `rezervor_nivel_initial_data`.
  Tabel nou `rezervor_alimentari` (ferma_id, data_ora, cantitate_litri, note, user_id),
  RLS: admin_central vede/adaugă/șterge tot, admin_ferma vede doar fermei sale.
- **Model de calcul** (simplificare asumată, de validat cu date reale — vezi comentarii în
  cod): `nivel_curent = nivel_initial + Σ(alimentări rezervor central) − Σ(consum utilaje
  calibrate ale fermei, din combustibil_citiri, toate scăderile inclusiv cele „suspecte”)`,
  calculat de la `nivel_initial_data` încoace. Se scade CONSUMUL (arderea de motor), nu
  evenimentele de realimentare individuală a utilajelor — presupunerea e că pe termen
  mediu se echilibrează. Dacă valorile nu se potrivesc cu realitatea pe teren, de
  reconsiderat modelul.
- **Edge Function** `get-rezervor-central` (deployată, verify_jwt: true, admin_central
  only) — calculează situația per fermă.
- **Pagină** `/rezervor-central` (admin_central only, link în nav „Rezervor central”):
  tabel cu capacitate/nivel curent/%/ultima alimentare, avertizare vizuală când nivelul
  scade sub 15%, formular de configurare inițială per fermă (capacitate + nivel curent
  acum → scrie direct în `ferme` via RLS), formular de înregistrare alimentare nouă (scrie
  direct în `rezervor_alimentari` via RLS), istoric alimentări expandabil per fermă.
- Fără Edge Function pentru scriere — `ferme` are deja politică UPDATE pentru admin_central,
  iar `rezervor_alimentari` are politică INSERT pentru admin_central, deci scrierile merg
  direct din frontend (`supabase-js`), protejate de RLS.
- **Pas rămas**: admin central trebuie să configureze inițial fiecare fermă (capacitate +
  nivel curent la o dată de referință) din pagina `/rezervor-central` înainte ca datele să
  apară calculate.

### 5b. Hartă parcele: trecere de la imagine statică la satelit real (2026-08-22)
Motiv: pentru a putea în viitor asocia traseul GPS al utilajelor cu parcela pe care se
aflau (point-in-polygon, vezi mai jos), poligoanele parcelelor trebuie coordonate GPS
reale, nu coordonate relative la o imagine încărcată manual.

- `components/FarmMap.tsx` rescris: hartă Leaflet cu toggle Stradă/Satelit (Esri World
  Imagery, la fel ca `/utilaje`), desenare poligoane prin click direct pe hartă
  (coordonate GPS reale, stocate tot ca GeoJSON Polygon în `parcele.poligon_harta`, dar
  acum `[lon, lat]` în loc de fracții 0..1 pe imagine).
- `ferme` are coloane noi: `centru_lat`, `centru_lon`, `centru_zoom` — centrul implicit
  al hărții per fermă. Admin central navighează o singură dată pe satelit până la fermă
  și apasă „📍 Setează ca centru implicit"; fără el, harta se deschide pe centrul
  aproximativ al României la zoom mic.
- `lib/parcelaTypes.ts`: `polygonLatLngs()` filtrează automat orice poligon cu coordonate
  în afara bounding-box-ului României — protecție împotriva poligoanelor vechi (format
  pixeli 0..1) afișate greșit ca GPS.
- Săbăreni (F5, ferma pilot) are acum 9 parcele (A1-A9) în `parcele`, gata de desenat pe
  satelit — A1-A3 aveau deja tip_gazon/suprafață din datele vechi, A4-A9 sunt goale (de
  completat din „Editează descrierea" după desenare). Pilotul FMC125 e deja pe această
  fermă (`utilaje.ferma_id` corect din instalarea inițială).

### 5c. Imagine suprapusă calibrată (2026-08-22)
Motiv: satelitul de bază (Esri) și Mapbox Satellite au fost verificate manual de Radu pe
zona Săbăreni — ambele cu imagine veche. Google Earth are imagine mult mai recentă
(sub 1 an) pe multe zone, dar nu poate fi folosit ca strat de tile-uri (necesită cont
Google Cloud cu card + API separat, vezi discuția de mai sus) — soluție aleasă: upload
manual al unui screenshot din Google Earth, suprapus și ancorat pe harta reală.

- `components/RotatedImageOverlay.tsx` (nou): poziționează o imagine peste harta Leaflet
  printr-o transformare afină calculată din 3 puncte GPS (colț stânga-sus, dreapta-sus,
  stânga-jos) — nu e un plugin extern, e calculat direct (matrice CSS `matrix(a,b,c,d,e,f)`
  aplicată pe element, recalculată la fiecare pan/zoom via `map.latLngToLayerPoint`).
- `ferme` are coloane noi: `imagine_colt_ss_lat/lon`, `imagine_colt_ds_lat/lon`,
  `imagine_colt_sj_lat/lon`. URL-ul imaginii refolosește `ferme.harta_url` (coloana veche,
  reactivată cu sens nou).
- Flux în `FarmMap.tsx` (admin central): „Adaugă imagine suprapusă" → upload în bucket-ul
  existent `harti-ferme` → mod calibrare (3 click-uri pe hartă, unul per colț, cu imaginea
  afișată alături ca referință vizuală) → „Salvează calibrarea" scrie URL + 3 puncte
  împreună într-un singur update (evită stări intermediare cu imagine nouă + colțuri
  vechi). „Recalibrează" și „Șterge imaginea" disponibile oricând.
- Control pentru toți utilizatorii (nu doar admin central) odată calibrată: transparență
  (slider) + arată/ascunde — util să compari overlay-ul cu satelitul de bază. Nu se
  persistă (revine la valorile implicite la reîncărcare — nu am considerat necesar mai
  mult pentru MVP).
- Poligoanele parcelelor rămân desenate independent, în coordonate GPS reale pe harta de
  bază — imaginea suprapusă e doar referință vizuală, nu afectează stocarea parcelelor.
- **Decizie**: nu s-a mai integrat tokenul Mapbox (Radu a verificat manual — imagine la
  fel de veche ca Esri pe zona fermelor) — rămas neutilizat, poate fi reconsiderat dacă
  Mapbox actualizează imagine pe altă zonă în viitor.

### 5d. Parcele circulare (pivot de irigații) — mod „Cerc" la desenare (2026-08-22)
Parcela 7 de la Săbăreni e perfect rotundă, cu un pivot de irigații în centru. Desenarea
punct-cu-punct pe un poligon neregulat ar fi imprecisă pentru o formă perfect circulară.

- `lib/geo.ts` (nou): `distantaMetri()` (haversine), `destinationPoint()` (punct la
  distanță+azimut dat), `generateCirclePolygon()` (generează un poligon regulat cu 64 de
  colțuri care aproximează un cerc).
- `FarmMap.tsx`: la desenarea unei parcele, toggle „Poligon" / „Cerc (pivot)". În mod
  Cerc: primul click = centru (locul pivotului), al doilea = un punct pe margine (stabilește
  raza, afișată live în metri; click-urile ulterioare ajustează raza). La salvare, cercul e
  convertit într-un poligon obișnuit cu 64 de puncte și scris în `poligon_harta` — **exact
  același format ca poligoanele desenate manual**, deci nimic altceva din aplicație (afișare,
  viitorul point-in-polygon utilaj↔parcelă) nu trebuie să știe că a fost un cerc.
- **Pas manual rămas** (blocat de un clasificator automat de siguranță — operațiune de
  golire în masă a datelor, necesită rulare directă în Supabase, nu prin Claude): rulează
  în Supabase Dashboard → SQL Editor:
  ```sql
  ALTER TABLE public.parcele DISABLE TRIGGER protejeaza_poligon_harta_trigger;
  UPDATE public.parcele SET poligon_harta = NULL WHERE poligon_harta IS NOT NULL;
  ALTER TABLE public.parcele ENABLE TRIGGER protejeaza_poligon_harta_trigger;
  ```
  Golește poligoanele vechi (coordonate pixeli, deja filtrate/ignorate de aplicație, dar
  tot merită curățate din DB). Fără acest pas, aplicația funcționează corect oricum
  (poligoanele vechi sunt ignorate automat), dar parcelele apar ca „fără contur" până se
  redesenează pe satelit — ceea ce oricum trebuie făcut din nou pentru toate parcelele.
- **Idee viitoare (nu implementată încă)**: odată parcelele redesenate pe satelit, se
  poate construi un raport care asociază traseul GPS al fiecărui utilaj (din
  `combustibil_citiri.latitudine/longitudine`, sincronizat la 15 min) cu parcela pe care
  s-a aflat (point-in-polygon) și durata — pentru pre-completare automată a parcelei +
  orelor de lucru la înregistrarea unei operațiuni.

### 5e. Gestiune liberă a parcelelor + zoom limitat la rezoluția imaginii (2026-08-22)
- `FarmMap.tsx`: buton „➕ Adaugă parcelă nouă" (admin central) — formular nume (obligatoriu)
  + tip gazon/suprafață (opționale), scrie direct în `parcele` (INSERT, RLS deja permite
  admin_central). Numărul și denumirile parcelelor nu mai sunt fixate din seed/SQL — se
  definesc liber din interfață.
- `ParcelaPanel.tsx`: buton „Șterge parcela" (admin central) cu confirmare inline. Nou:
  politică RLS DELETE pentru admin_central pe `parcele` (nu exista înainte). FK-urile spre
  `operatiuni`/`recoltari` sunt `NO ACTION` — ștergerea unei parcele cu istoric eșuează
  automat la nivel de bază de date; interfața prinde eroarea (cod Postgres `23503`) și
  arată un mesaj clar în loc de eroarea brută SQL.
- Redenumirea rămâne prin „Editează descrierea" (funcționalitate existentă, neschimbată).
- **Zoom maxim = rezoluția reală a imaginii suprapuse**: `lib/geo.ts` →
  `zoomForResolution()`. La încărcarea imaginii calibrate, se calculează metri/pixel din
  distanța reală dintre colțurile calibrate (`distantaMetri`) împărțită la dimensiunea
  naturală a fișierului, apoi zoom-ul Web Mercator corespunzător (clamped 14-22). Aplicat
  cu `map.setMaxZoom()` — peste acel nivel, nici imaginea suprapusă, nici satelitul de bază
  nu mai arată detalii reale, doar pixeli măriți, deci zoom-ul e blocat acolo.

### Flotă auto (mașini de pasageri) — caz de utilizare separat
Scop: doar foi de parcurs (trip logs), fără monitorizare combustibil, fără abonament
la providerul GPS existent.
- Opțiuni comparate: FMC920 (cel mai simplu/ieftin, suficient pentru tracking + foi de
  parcurs), FMC130 (intrări/ieșiri configurabile în plus, input negativ, input impuls),
  FMC125 (cel mai avansat, RS232/RS485 — nefolosit aici, gândit pentru senzori externi).
- **Decizie finală: FMC130** — motiv: preț bun (50 EUR/buc în România), consultanță și
  garanție locală incluse. Se configurează identic în Traccar (IMEI + device nou),
  funcționează la fel pentru rapoarte de traseu.

## 6. Structură fișiere / cod — reper rapid

- `lib/supabaseClient.ts` — client Supabase (folosește variabilele de mediu).
- `lib/useUserRole.ts` — hook pentru rolul utilizatorului curent.
- `lib/postLoginRedirect.ts` — logica de redirect după login (admin_ferma vs admin_central).
- `lib/parcelaTypes.ts`, `lib/operatiuniTypes.ts` — tipuri + constante (inclusiv etichetele
  din secțiunea 3 de mai sus).
- `components/LayoutShell.tsx` — meniul de navigare + logout.
- `components/FarmMap.tsx` — harta interactivă cu poligoane.
- `components/ParcelaPanel.tsx` — panoul de parcelă (descriere + operațiuni + istoric).
- `app/utilizatori/` — ecran de administrare conturi.
- `supabase/functions/admin-create-user/` — Edge Function pentru creare conturi (deployed).
- `supabase/functions/sync-traccar-fuel/` — Edge Function sincronizare combustibil
  (ACTIVĂ, cron 15 min — vezi secțiunea 5).
- `supabase/functions/get-combustibil-report/` — raport consum/realimentări/scăderi
  suspecte per utilaj (`/combustibil`, admin_central only).
- `supabase/functions/get-rezervor-central/` — situație rezervor central per fermă
  (`/rezervor-central`, admin_central only).
- `supabase/schema-*.sql` — copii sursă-de-adevăr ale migrărilor SQL aplicate în Supabase.

## 7. Ce rămâne pentru faza 2 (neschimbat față de spec-ul inițial din CLAUDE.md)

- Tracking paleți per client (istoric, nu doar sold global).
- Modul achiziții/furnizori pentru substanțe.
- Alerte stoc minim.
- Rapoarte financiare/costuri.
- Fișe complete de clienți / comenzi.
- Integrare completă combustibil (Traccar + DUT-E → aplicație), condiționată de
  finalizarea testelor pe pilot.
