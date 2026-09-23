# Note de proiect — decizii, status, context tehnic

Acest fișier e memorie externă pentru proiect: decizii importante, ce s-a construit
deja, și de ce s-au ales anumite soluții. Scopul e ca informația să supraviețuiască
chiar dacă o conversație cu Claude se pierde sau se rezumă. Se actualizează pe măsură
ce apar decizii noi — nu e nevoie să reconstruim contextul din memorie de fiecare dată.

Ultima actualizare: 2026-08-27.

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

### 5f. Tipuri de gazon editabile din interfață (2026-08-22)
Lista de tipuri de gazon (înainte hardcodată în cod: rustic/sport/în pregătire) e acum un
tabel gestionabil din aplicație, nu mai necesită modificare de cod pentru extindere.

- Tabel nou `tipuri_gazon` (id, nume unic) — `supabase/schema-tipuri-gazon.sql`. Seedat cu
  cele 3 valori vechi, ca să nu se schimbe nimic pentru parcelele existente.
- RLS: oricine autentificat vede lista (necesar pentru dropdown-uri), doar admin_central
  adaugă/actualizează/șterge.
- **Notă importantă**: `parcele.tip_gazon` rămâne coloană de text liber, NU foreign key
  către `tipuri_gazon` — lista alimentează doar dropdown-urile, nu impune o constrângere
  strictă. Ștergerea unui tip din listă nu afectează parcelele care îl folosesc deja
  (rămân cu eticheta text, doar nu mai apare ca opțiune la parcele noi).
- UI: buton „⚙️ Gestionează tipurile de gazon" în `FarmMap.tsx` (admin central) — listă cu
  ✕ de ștergere per tip + câmp „Tip nou" + Adaugă. Ambele select-uri care foloseau lista
  hardcodată (form „Adaugă parcelă" din `FarmMap.tsx` și „Editează descrierea" din
  `ParcelaPanel.tsx`) acum citesc din `tipuriGazon`, primit ca prop de la
  `FermaTarlaScreen.tsx` (fetch din `tipuri_gazon`, cu funcție de reload dedicată apelată
  după orice adăugare/ștergere).

### 5g. Etichetă cu numele parcelei pe hartă (2026-08-22)
`FarmMap.tsx`: fiecare poligon de parcelă are acum numele afișat în centrul lui pe hartă
(text alb cu contur negru, lizibil peste orice fundal), ca admin-ul fermei să știe ce
selectează înainte să dea click. Implementat cu `L.divIcon` + `Marker` non-interactiv
(`interactive={false}`), poziționat la centroidul geometric al poligonului
(`centroidLatLng()` din `lib/parcelaTypes.ts`, media aritmetică a punctelor — suficient de
precisă pentru forme convexe/aproape convexe ca parcelele noastre, inclusiv cercurile).
Click-ul trece prin etichetă direct la poligonul de dedesubt.

### 5h. Istoric ore de funcționare pe parcele, per utilaj (2026-08-27)
Din același traseu GPS folosit pentru harta live, se calculează acum câte ore a
funcționat fiecare utilaj (motor pornit — atribut Traccar `ignition`) și pe ce parcele,
pe zile. Cerere: „click pe utilaj → istoric pe zile, ore + parcele, tabel".

- `combustibil_citiri` (redenumire conceptuală, nu de tabel — vezi mai jos) capturează
  acum o citire pentru **orice** utilaj cu poziție GPS validă, indiferent dacă are sau nu
  senzor de combustibil calibrat — altfel utilajele fără DUT-E n-ar avea deloc traseu
  salvat. Coloană nouă `contact` (boolean, din `attributes.ignition` Traccar).
  `nivel_litri` a devenit nullable (rânduri doar-poziție nu au valoare de combustibil).
- **Efect colateral corectat**: `nivel_litri` nullable ar fi stricat calculul deltelor de
  consum (`Number(null) = 0` → salturi false) în `get-combustibil-report`,
  `get-rezervor-central` și `get-utilaje-positions` — toate trei au primit
  `.not('nivel_litri', 'is', null)` pe interogările relevante, redeployate.
- Edge Function nouă `supabase/functions/get-utilaj-istoric-parcele/` (admin_central only,
  param `utilaj_id` + `zile`, implicit 14): parcurge traseul cronologic al utilajului,
  pentru fiecare interval între două citiri consecutive — dacă la începutul intervalului
  contactul era pornit și golul dintre citiri ≤ 1h (peste, presupunem device offline, nu
  funcționare continuă) — adaugă durata la total ore/zi; dacă poziția de la începutul
  intervalului cade în interiorul unui poligon de parcelă (ray-casting, aceeași logică
  RO-bounding-box de validare ca în `lib/parcelaTypes.ts`), adaugă și la ore/parcelă/zi.
  Zilele sunt calculate în fus orar România (`Europe/Bucharest`), nu UTC.
- UI: `app/utilaje/UtilajeScreen.tsx` — click pe orice rând din tabelul de utilaje extinde
  un rând cu istoricul (dropdown 7/14/30 zile), tabel Dată / Ore pe parcele / Total ore
  funcționare. Dacă ferma nu are parcele desenate, se arată doar totalul de ore.
- Suma orelor pe parcele poate fi < totalul de funcționare — diferența e timp cu motorul
  pornit în afara oricărei parcele (deplasare, drum).
- **2026-08-27, aceeași zi**: interval de sincronizare Traccar redus de la 15 la 5 minute
  (`supabase/schema-cron-sync-traccar.sql`) — cerere explicită pentru precizie mai bună.
- **2026-08-27, îmbunătățire majoră de precizie**: verificat direct în Traccar (Reports ->
  Positions) — cât timp utilajul se mișcă, FMC125 raportează o poziție nouă la fiecare
  2-15 secunde; cât timp stă pe loc, doar o dată pe oră (heartbeat). `sync-traccar-fuel` a
  fost rescris să ceară din Traccar **tot istoricul de poziții** de la ultima citire
  salvată până acum (`GET /api/positions?deviceId=X&from=...&to=...`), nu doar "poziția
  curentă" ca înainte — altfel rezoluția reală era limitată la intervalul de cron (5 min),
  pierzând aproape toate pozițiile intermediare cât timp utilajul lucra. Acum se prinde
  fiecare poziție reală raportată de device. Protecție: dacă ultima citire salvată e mai
  veche de 3 ore (`MAX_LOOKBACK_ORE`), nu se recuperează tot golul dintr-o singură rulare
  (ar cere de la Traccar prea multe puncte deodată) — rămâne un gol în istoric în acel caz.

### 5h-bis. Bug: total ore/zi variabil după fereastra 7/14/30 zile (2026-09-02)
Raportat: pentru aceleași zile (27-28 august), „Istoric ore pe parcele" arăta totaluri
diferite după ce interval era ales din dropdown (30/14/7 zile) — 28 august: 5.2h / 5.3h /
6h. Cauză: consecință directă a preciziei descrise mai sus (5h, poziție la fiecare 2-15s
cât timp utilajul se mișcă) — `combustibil_citiri` are 2246 rânduri doar pe ultimele 30 de
zile pentru un singur utilaj activ, peste limita implicită Supabase/PostgREST de 1000 de
rânduri per `.select()`. Fără paginare explicită, query-ul din
`get-utilaj-istoric-parcele` se trunchia silențios (fără eroare) la primele 1000 rânduri
cronologice — cu o fereastră mai largă (30 zile), mai multe citiri vechi/irelevante
consumau bugetul de 1000 înainte să ajungă la ziua recentă, lăsând mai puține date pentru
28 august (total mai mic); cu fereastră îngustă (7 zile), aproape tot bugetul rămânea
disponibil pentru zilele recente (total mai mare, mai aproape de realitate).
- **Fix**: helper `fetchToateRandurile()` (paginare explicită prin `.range()` până se
  golește rezultatul) adăugat și folosit în cele trei Edge Functions cu același risc —
  toate agregă `combustibil_citiri` pe intervale lungi fără limit: `get-utilaj-istoric-
  parcele`, `get-combustibil-report`, `get-rezervor-central`. Redeployate.
- **Risc similar neadresat, semnalat**: `get-utilaje-positions` citește "ultima citire de
  combustibil" per utilaj dintr-un `.select()` fără fereastră de dată, ordonat descrescător
  — cum truncarea la 1000 păstrează cele mai recente rânduri, riscul e mult mai mic (ar
  afecta doar un utilaj care n-a raportat de mult timp, într-un context cu multe alte
  utilaje foarte active), dar merită același tratament dacă apare vreodată o discrepanță.

### 5i. Harta /utilaje: aceeași hartă cu parcelele + overlay (2026-08-27)
`UtilajeMapView.tsx` afișa doar markere de utilaje pe o hartă simplă (stradă/satelit),
fără parcele — cerere: să se vadă exact pe ce parcelă e fiecare utilaj.

- Rescris să primească și `ferme` (cu `harta_url` + cele 3 colțuri calibrate) și `parcele`
  (toate fermele, nu doar una) ca props, în plus față de pozițiile utilajelor.
- Randează pe **aceeași** hartă satelit: `RotatedImageOverlay` pentru fiecare fermă care
  are imagine calibrată (aceeași componentă ca pe `/ferme/[fermaId]`), plus poligoanele +
  etichetele tuturor parcelelor (`polygonLatLngs`, `centroidLatLng`, `PARCELA_COLORS` din
  `lib/parcelaTypes.ts`) — apoi markerele utilajelor deasupra.
- Funcționează pe o singură hartă combinată (nu una per fermă) pentru că overlay-urile
  sunt calibrate cu coordonate GPS reale — se poziționează automat corect indiferent câte
  ferme sunt afișate simultan, fără conflicte.
- `UtilajeScreen.tsx`: la reîncărcare, pe lângă `get-utilaje-positions`, se aduc direct din
  Supabase (RLS admin_central) toate rândurile din `ferme` (coloanele hărții) și `parcele`.
- Read-only — fără instrumentele de desenare/editare din `FarmMap.tsx` (acelea rămân doar
  pe `/ferme/[fermaId]`).

### 5j. Poză per utilaj + fix scalare io201 combustibil (2026-09-09)

**Poză utilaj**: `utilaje.poza_url` (text) + bucket storage nou `poze-utilaje` (public,
RLS: SELECT public, INSERT/UPDATE/DELETE doar admin_central) — aceeași rețetă ca bucket-ul
`harti-ferme` existent. `/utilaje`: coloană nouă cu thumbnail clickabil → upload direct din
tabel (`UtilajeScreen.tsx`, funcția `incarcaPoza`). Harta utilajelor (`UtilajeMapView.tsx`)
arată poza în popup-ul markerului, dacă există. `get-utilaje-positions` întoarce și
`poza_url`.

**Fix scalare combustibil (bug real, nu doar UI)**: Radu a calibrat senzorul DUT-E să
trimită direct „Volume of fuel (L)" (nu mai valoare brută/„kvants") — pe ecranul propriu al
sondei apare 37.5 l, dar Traccar (`io201`) citea 375. Cauză: elementul I/O `io201` e
configurat pe FMC125 cu o zecimală codificată ca număr întreg (multiplier 0.1) — scalarea
x10 vine din configurarea FMC125, nu din DUT-E, deci se aplică indiferent dacă senzorul
trimite kvants sau litri reali. Fix: `sync-traccar-fuel/index.ts` → `extractFuelLiters()`
împarte la 10 specific pentru cheia `io201` (nu și pentru fallback-urile `fuel1`/`fuel`/
`fuelLevel`, care n-au acest offset confirmat). Redeployat (v8).

Notă: fix-ul se aplică doar citirilor NOI, de acum încolo — istoricul deja salvat în
`combustibil_citiri` (peste 4300 rânduri pe pilotul Săbăreni) rămâne cu valorile vechi
(x10, sau „kvants" brute dinainte de calibrarea DUT-E) — nu am făcut backfill, de
reconsiderat dacă Radu are nevoie de rapoarte istorice corecte în litri.

Observat în trecere, nerezolvat: `max(nivel_litri)` pe pilot = 65532 — arată a valoare
santinelă/eroare Teltonika (tipic pentru un câmp pe 16 biți fără semn, „fără date"), nu o
citire reală de combustibil. De filtrat explicit dacă apare des (ar strica deltele de
consum din `get-combustibil-report`/`get-rezervor-central`).

Pilotul (`Pilot Săbăreni`) tot n-are `utilaje.tanc_capacitate_litri` completat — cât timp
rămâne necompletat, aplicația îl tratează în continuare ca „necalibrat" (exclus din
rapoartele de consum) chiar dacă senzorul fizic e acum calibrat corect. De completat în
`/utilaje` quando Radu confirmă valoarea reală a rezervorului.

**Update 2026-09-10**: adăugată editare inline a `tanc_capacitate_litri` direct din
`/utilaje` (icon ✎ lângă valoarea de combustibil) — nu mai e nevoie de acces direct la
baza de date pentru asta.

**Update 2026-09-10 — backfill valori combustibil**: Radu a calibrat senzorul DUT-E să
trimită direct litri („Volume of fuel (L)"), dar Traccar tot citea x10 (375 în loc de
37.5) — cauza: elementul I/O `io201` e configurat pe FMC125 cu multiplier 0.1 (o
zecimală codificată ca întreg), independent de ce trimite DUT-E intern. Fix aplicat în
`sync-traccar-fuel` (împarte la 10 specific pentru `io201`) ȘI backfill retroactiv al
celor 4367 rânduri deja existente în `combustibil_citiri`
(`update combustibil_citiri set nivel_litri = nivel_litri / 10.0 where nivel_litri is
not null`) — istoricul complet e acum corect scalat, nu doar citirile noi.

### 5k. Bug real (nu doar flaky platformă): fetchToateRandurile generic → 503 persistent (2026-09-10)

Bug-ul „eroare de rețea" raportat pe 5h-bis (503 + CORS chiar pe OPTIONS preflight) NU
s-a rezolvat de la sine cum s-a presupus inițial — a persistat identic peste o
săptămână, pe toate cele 3 funcții care foloseau helper-ul `fetchToateRandurile<T>()`
introdus atunci (`get-utilaj-istoric-parcele`, `get-combustibil-report`,
`get-rezervor-central`), în timp ce `get-utilaje-positions` (fără acest helper,
redeployată separat în aceeași perioadă) a funcționat mereu corect.

Factorul comun clar: funcția generică async `fetchToateRandurile<T>(...)`. Fix aplicat —
**degenerizare**: fiecare din cele 3 funcții are acum propriul `fetchToateRandurile()`
netipizat generic, cu tipul de rând concret (`Citire`) hardcodat direct în semnătură, în
loc de `<T>`. Redeployate toate trei (versiuni noi). Cauza exactă tot nedemonstrată cert
(instrumentele de logs pentru acest proiect tot nu funcționează — orice interogare
răspunde „tabela nu există", pe orice nume de tabelă din Logs Explorer, inclusiv
`edge_logs`/`function_edge_logs` — pare o problemă separată la nivel de proiect
Supabase), dar corelația cu exact codul modificat + persistența de peste o săptămână
face improbabilă teoria inițială de „blip tranzitoriu de platformă". **Confirmat de
Radu pe 2026-09-10: „acum merge" — fix-ul a rezolvat problema.**

### 5l. Fix real pe „scăderi suspecte" false-pozitive — citiri peste capacitate + comprimare extreme (2026-09-10)

Radu a semnalat scăderi suspecte care nu au corespondent real (rezervor 90 l, umplut
full la calibrare, consum zilnic normal, o singură realimentare reală) — "de ce sunt
aceste scaderi suspecte? trebuie sa reglam asta".

Investigare pe datele brute din `combustibil_citiri` pentru utilajul reclamat (Pilot
Săbăreni) a arătat cauza exactă, nu doar o presupunere:
- Înainte de calibrarea în teren a senzorului DUT-E (momentul exact: 2026-09-09
  13:42:15, local 16:42), citirile erau valori brute necalibrate ("kvants"), în
  intervalul ~106-190 — peste capacitatea reală a rezervorului (90 l). Aceste valori
  au trecut nedetectate prin fix-ul anterior (împărțirea la 10 a lui `io201`, vezi 5j)
  fiindcă acela corectează multiplicatorul FMC125, nu calibrarea internă a senzorului.
- Fiecare "scădere suspectă" din raport corespundea fie unui asemenea artefact brut
  (zgomot de senzor în intervalul necalibrat, ex. -15.3 l pe 04.09, -20.1/-26.7 l pe
  07.09), fie exact saltului de discontinuitate de la recalibrare (-68.8 l pe 09.09
  16:42:15 — trecerea instantanee de la ~106 [brut] la 37.5 [litri reali calibrați]).
  Niciuna nu era consum sau furt real.
- În plus, o realimentare turnată treptat (citiri RS232 succesive în timp ce se toarnă
  motorina) era tăiată în pași sub pragul minim de 15 l și o parte din cantitate
  "dispărea" din total — realimentarea reală de 55.29 l din 10.09 apărea în raport ca
  doar 42.6 l.

Fix aplicat în `get-combustibil-report` și `get-rezervor-central` (aceeași logică de
calcul, deci aceeași vulnerabilitate în amândouă):
1. `filtreazaCitiriPlauzibile()` — elimină orice citire peste capacitatea declarată a
   rezervorului (`tanc_capacitate_litri` × 1.05 toleranță) sau negativă, înainte de
   orice calcul de deltă. O citire fizic imposibilă nu mai poate fi folosită ca reper.
2. (doar `get-combustibil-report`) `extrageExtreme()` — comprimă citirile valide în
   punctele lor de întoarcere (extreme locale), ca o realimentare/scurgere surprinsă
   în mai mulți pași RS232 succesivi să fie tratată ca UN eveniment, nu tăiată artificial.

Verificat prin simulare pe datele reale (Pilot Săbăreni, 09-10.09): cu fix-ul, toate
cele 5 scăderi suspecte false dispar (citirile care le generau sunt filtrate), iar
realimentarea din 10.09 e recunoscută corect ca ~54.6 l (față de 42.6 l înainte) —
foarte aproape de cei 55.29 l reali declarați de Radu. Deploy: `get-combustibil-report`
v5, `get-rezervor-central` v5.


### 5m. Reorganizare meniu — grupare pe secțiuni (2026-09-10)

La cererea lui Radu, meniul din `components/LayoutShell.tsx` e reorganizat pe
secțiuni vizuale (etichetă gri, mică, necliclabilă — navigarea rămâne tot un
singur click, nu s-a introdus acordeon/pliere):

- **(negrupat, sus)** — Acasă, Dashboard, Ferme, Substanțe — folosite zilnic de
  ambele roluri admin.
- **Flotă auto** — Mașini, Curse (admin_central + admin_ferma); Foi de parcurs,
  Alerte (doar admin_central).
- **Utilaje** — Utilaje, Combustibil, Rezervor central (doar admin_central);
  Alimentări utilaje (admin_central + admin_ferma).
- **Administrare** (doar admin_central) — Utilizatori, Zone (geofences),
  Tracking (link extern către serverul Traccar brut — mutat aici din grupul
  Flotă auto, fiindcă e un instrument tehnic comun ambelor flote de GPS-uri,
  nu specific mașinilor).

Vizibilitatea per rol e neschimbată față de înainte — doar gruparea vizuală
e nouă (aceleași condiții de rol, doar rearanjate sub etichete).

Observație în trecere: paginile `/livrari` și `/recoltari` există în cod dar
sunt doar stub-uri necompletate ("Înregistrare livrări și sold paleți" /
"Înregistrare recoltări și rapoarte", fără logică reală) și nu sunt legate
din nicio pagină — nu au fost adăugate în meniu ca să nu creeze impresia unei
funcționalități complete. `/tracking` (ruta internă, diferită de link-ul extern
Tracking) e cod mort — face doar redirect instant către `/dashboard`.

### 5n. Bug: device-uri/utilaje noi din Traccar invizibile pe hartă și fără sincronizare (2026-09-11)

Radu a legat 3 utilaje noi din Traccar, dar nu apăreau pe harta din
`/utilaje`. Aceeași cauză descoperită la 5l/list-traccar-devices (Traccar
`GET /api/devices` și `GET /api/positions` FĂRĂ `all=true` întorc implicit
doar device-urile alocate explicit contului TRACCAR_USER) era prezentă și în
alte 4 Edge Functions care nu fuseseră atinse când s-a reparat doar
`list-traccar-devices`:

- `get-utilaje-positions` — hartă live `/utilaje` (devices + positions).
- `get-masini-positions` — hartă live `/masini` (devices + positions).
- `sync-traccar-fuel` — cron sincronizare combustibil (doar devices; apelurile
  per-device la `/api/positions?deviceId=...` sunt deja filtrate explicit,
  nu au nevoie de `all=true`).
- `sync-traccar-masini` — cron sincronizare poziții/curse mașini (idem, doar
  devices).

Impact real: nu doar hărțile nu arătau utilajele/mașinile noi — combustibilul
(sync-traccar-fuel) și pozițiile/cursele (sync-traccar-masini) pentru orice
device nou legat din Traccar nu se sincronizau deloc, fiindcă maparea inițială
IMEI → id intern Traccar (din `/api/devices`) rata device-urile nealocate
explicit contului aplicației.

**Fix pasul 1**: adăugat `?all=true` la toate cele 4 apeluri de mai sus (după
modelul din `list-traccar-devices`, vezi comentariul de acolo). Deployed:
`get-utilaje-positions` v8, `get-masini-positions` v3, `sync-traccar-fuel` v9,
`sync-traccar-masini` v2.

**Fix pasul 2 (2026-09-11, root cause real pentru hărți)**: după fix-ul de mai
sus, utilajele noi apăreau în listă dar tot nu apăreau pe hartă. Diagnostic cu
log-uri temporare în `get-utilaje-positions`: apelul bulk
`GET /api/positions?all=true` întorcea doar 2 poziții din 5 device-uri Traccar
— deși toate 5 aveau poziție vizibilă în Traccar (web/app mobil). Cauză:
`all=true` pe `/api/positions` întoarce „ultima poziție" per device conform
unui pointer intern (`device.positionId`), care nu se actualizează la fel de
fiabil ca istoricul real de poziții din Traccar (probabil doar la poziții
„valide" după criteriile lui Traccar, nu la orice update de rețea).

**Fix**: în `get-utilaje-positions` și `get-masini-positions`, pentru orice
device găsit dar fără poziție în apelul bulk, se face un apel individual pe
istoricul din ultimele 30 de zile (`/api/positions?deviceId=X&from=...&to=...`
— aceeași metodă folosită deja cu succes de `sync-traccar-fuel`/
`sync-traccar-masini`, care nu are nevoie de acest fallback fiindcă apelează
deja per-device de la bun început) și se ia cea mai recentă poziție din listă.
Confirmat de Radu 2026-09-11: „apar toate" — toate 4 utilaje apar acum pe
hartă. Deployed: `get-utilaje-positions` v11, `get-masini-positions` v4.

### 5o. Pagina /substante — alimentare gestiuni ferme + nomenclator + preț de intrare (2026-09-15)
Cerință Radu: admin general trebuie să poată alimenta gestiunea fiecărei
ferme cu substanțe (denumire din nomenclator + cantitate), cu prețul de
intrare, ca să se poată calcula ulterior exact costul de producție. Aceasta
e exact modulul „achiziții/furnizori pentru substanțe" lăsat pentru faza 2 în
spec-ul inițial (secțiunea 7 mai jos) — acum implementat parțial (fără
furnizori ca entitate separată, doar câmp text opțional).

**Schimbare de model important**: până acum `substante` avea și politici
RLS care permiteau lui admin_ferma să insereze/actualizeze direct rândurile
fermei sale (fără preț de intrare, fără istoric). Cerința lui Radu ("o
persoană cu drepturi de admin general trebuie să poată alimenta...") a fost
citită ca restrângere intenționată — alimentarea (creșterea stocului +
prețul de intrare) se face acum DOAR de admin_central, printr-un flux
auditat. admin_ferma păstrează acces de citire (stoc curent + istoric
intrări pentru ferma proprie), dar nu mai poate insera/actualiza direct
`substante`. Dacă asta nu e ce își dorea Radu (ex. dacă admin_ferma chiar
trebuie să poată opera stocuri fără preț), trebuie revizitat.

**Schema nouă (migrare `substante_nomenclator_si_intrari`, aplicată
2026-09-15)**:
- `substante_nomenclator` — catalog global (nume unic + unitate_masura),
  vizibil tuturor utilizatorilor autentificați, editabil doar de
  admin_central. Separat de `substante` (care rămâne „stocul per fermă")
  ca să nu se reintroducă denumiri diferite pentru aceeași substanță la
  ferme diferite.
- `substante.nomenclator_id` — coloană nouă, FK către nomenclator, cu
  constrângere unică `(ferma_id, nomenclator_id)` — o singură linie de stoc
  per (fermă, substanță din nomenclator).
- `substante_intrari` — jurnal/audit al fiecărei alimentări: cantitate,
  preț de intrare unitar, dată, furnizor (text liber, opțional), notă,
  cine a introdus (`introdus_de`). SELECT permis și lui admin_ferma pentru
  intrările fermei sale; INSERT/UPDATE/DELETE doar admin_central (de fapt
  scrise doar prin funcția RPC de mai jos, nu direct din UI).
- Funcția `alimenteaza_substanta(p_ferma_id, p_nomenclator_id, p_cantitate,
  p_pret_intrare_unitar, p_data, p_furnizor, p_nota)` — SECURITY DEFINER,
  verifică `is_admin_central()` intern, face upsert atomic pe `substante`
  (creează linia dacă nu există, altfel adună cantitatea la stoc) și
  recalculează `pret_unitar` ca **medie ponderată** cu stocul deja existent:
  `((stoc_vechi*pret_vechi) + (cantitate_nouă*preț_intrare)) /
  (stoc_vechi+cantitate_nouă)` — același `pret_unitar` deja citit de
  `app/dashboard/cost-productie/page.tsx` pentru calculul costului de
  producție, deci raportul de cost beneficiază automat, fără alte
  modificări. Apoi inserează rândul de audit în `substante_intrari`.

**Frontend** (`app/substante/SubstanteScreen.tsx`, înlocuiește stub-ul
inițial din `page.tsx`):
- admin_central vede: managementul nomenclatorului (adaugă denumire +
  U.M.), formularul „Alimentare gestiune fermă" (fermă + substanță din
  nomenclator + cantitate + preț intrare + dată + furnizor/notă opționale,
  apelează RPC-ul de mai sus, arată costul total calculat live), tabelul de
  stoc curent pe toate fermele (cu valoare stoc = stoc × preț mediu) și
  istoricul ultimelor 50 de alimentări (toate fermele).
- admin_ferma vede: doar stocul curent și istoricul alimentărilor pentru
  ferma proprie (RLS filtrează automat), fără formular de alimentare — text
  explicit că alimentarea se face de admin general.
- Nu ating `components/ParcelaPanel.tsx` (consumul de substanțe la
  operațiuni pe parcelă) — verificat înainte că citește `substante` cu
  `substanta_id`/`nume`/`unitate_masura`, formă neschimbată de migrare.

### 5p. Cost de producție — stare completă + bug fix cheltuieli indirecte (2026-09-15)
Radu a descris planul complet pentru calculul prețului de producție al
rulourilor: costuri directe (motorină pe baza citirilor de sondă, substanțe
pe baza rapoartelor zilnice ale șefilor de fermă) + costuri indirecte
(facturi utilități, salarii, chirii, reparații etc., introduse de admin
general). Verificare: `/cheltuieli-indirecte` (admin_central only) și
`app/dashboard/cost-productie/page.tsx` EXISTAU DEJA, construite anterior
(nu în această sesiune) — nu erau documentate în NOTES.md.

Stare curentă a `dashboard/cost-productie`: combină per fermă+lună — cost
manoperă (`operatiuni.ore_lucru × ferme.cost_ora_lucru`), cost materiale
(`operatiuni_substante.cantitate × substante.pret_unitar` — beneficiază
automat de prețul de intrare introdus prin noul flux din 5o) și cheltuieli
indirecte (`cheltuieli_indirecte`, grupate pe lună calendaristică din
`data`). **Lipsă confirmată**: costul combustibilului NU e inclus încă —
`combustibil_citiri`/`alimentari_utilaje` înregistrează doar litri, nu preț
per litru; nicio structură din bază nu are momentan preț motorină. De
adăugat quando Radu decide sursa prețului (preț per alimentare manuală,
sau un preț curent setat periodic) — vezi mesajul trimis lui Radu.

**Bug fix**: `cheltuieli_indirecte` avea politici RLS pentru admin_central
doar pe SELECT/INSERT/UPDATE, nu și DELETE — butonul „Șterge" din UI eșua
silențios (Supabase nu aruncă eroare la DELETE fără rânduri afectate din
cauza RLS, doar șterge 0 rânduri), iar UI arăta mesaj fals de succes.
Adăugată politica DELETE lipsă (migrare `cheltuieli_indirecte_delete_policy`).

### 5q. Preț motorină la fiecare alimentare a rezervorului central (2026-09-15)
Continuare la 5p: Radu a confirmat că prețul motorinei se introduce la
FIECARE alimentare a rezervorului central al unei ferme (`/rezervor-central`),
nu ca preț curent unic — motorina variază constant de la o livrare la alta.

- `rezervor_alimentari.pret_litru` — coloană nouă, `not null check (>= 0)`
  (tabela nu avea rânduri existente, deci fără nevoie de backfill). Formularul
  „Înregistrează o alimentare" cere acum și prețul, alături de cantitate.
- `get-rezervor-central` (v6): selectează și `pret_litru`, calculează
  `pret_litru_mediu` = medie ponderată cu cantitatea pe toate alimentările
  din fereastra urmărită (de la `rezervor_nivel_initial_data`), afișat pe
  ecran per fermă; istoricul de alimentări arată prețul fiecărei livrări.
- **Rămâne de făcut**: integrarea în `dashboard/cost-productie` — costul
  lunar de combustibil per fermă = consum lunar (din `combustibil_citiri`,
  aceeași metodă ca `total_consumat_litri` de mai sus, dar pe luni, nu
  cumulat) × prețul mediu al motorinei valabil în acea lună. Necesită
  extinderea calculului de consum la bucket-uri lunare (momentan
  `get-rezervor-central` dă doar un total cumulat de la data configurării,
  nu o defalcare pe lună) — de făcut într-o sesiune viitoare.

### 5r. Cost de producție complet, pe lună, cu combustibil inclus (2026-09-15)
Continuare la 5p/5q — Radu a confirmat să integrăm și combustibilul. Pagina
`/dashboard/cost-productie` a fost RECONSTRUITĂ, nu doar completată:

**Bug grav găsit și reparat**: pagina veche era un Server Component Next.js
care interoga Supabase direct cu clientul anonim (`lib/supabaseClient.ts`,
fără sesiunea utilizatorului). RLS pe `ferme`/`parcele`/`operatiuni`/
`operatiuni_substante`/`cheltuieli_indirecte` cere `auth.role() =
'authenticated'` — deci acele query-uri întorceau mereu 0 rânduri. Raportul
era gol încă de la construire, indiferent de datele din bază. Al doilea bug
găsit în același loc: costul de manoperă+materiale era calculat ca TOTAL
all-time (ignorând `operatiuni.data`), apoi adunat la fiecare lună găsită în
cheltuielile indirecte — dacă existau cheltuieli indirecte în 3 luni diferite,
manopera+materialele erau numărate de 3 ori în totalul general.

**Fix**: rescris ca pagină client (`CostProductieScreen.tsx`, 'use client',
gate admin_central prin `useUserRole` ca restul aplicației) care apelează o
edge function nouă, `get-cost-productie` (service role, urmează exact
tiparul `get-rezervor-central`/`get-combustibil-report`: paginare explicită
pe `combustibil_citiri`, filtrare citiri implauzibile peste capacitate).
Funcția grupează TOATE cele patru costuri pe aceeași cheie (fermă, lună
calendaristică din `operatiuni.data` / `cheltuieli_indirecte.data` /
`combustibil_citiri.data_ora`), deci nu se mai poate dubla nimic:
- manoperă: `operatiuni.ore_lucru × ferme.cost_ora_lucru`
- substanțe: `operatiuni_substante.cantitate × substante.pret_unitar`
- indirecte: `cheltuieli_indirecte.valoare`
- **combustibil (nou)**: consum lunar deducut din scăderile de nivel din
  `combustibil_citiri` ale utilajelor calibrate ale fermei (aceeași metodă
  ca `get-rezervor-central`, dar pe bucket-uri lunare, nu cumulat) ×
  prețul mediu ponderat al motorinei cumpărate de acea fermă PÂNĂ la
  sfârșitul lunii respective (din `rezervor_alimentari.pret_litru`, cumulativ
  cronologic — vezi 5q). Lunile dinaintea primei alimentări cu preț
  înregistrat arată litrii consumați, dar cu cost „necunoscut" (nu 0 —
  ca să nu subestimeze silențios costul real).

Deployed: `get-cost-productie` v1 (funcție nouă). `dashboard/cost-productie`
rămâne accesibilă din `/dashboard` (nu e în meniul principal, la fel ca
`/cheltuieli-indirecte` — ambele doar prin pagina Dashboard).

### 5s. Jurnal de activitate (audit log) — secțiunea Administrare (2026-09-15)
Cerere Radu: să știe exact ce utilizator a modificat ce date, admin de fermă
sau admin general deopotrivă. Implementat la nivel de bază de date, nu de
frontend, ca să prindă orice modificare indiferent pe unde intră (formular,
RPC, chiar și o editare directă din SQL) și să nu rămână în urmă pe măsură
ce aplicația evoluează.

- `jurnal_activitate` — tabelă de log append-only (id bigint identity,
  tabel, operatie INSERT/UPDATE/DELETE, rand_id, utilizator_id +
  utilizator_nume/rol denormalizate la momentul faptei — rămân corecte
  chiar dacă userul e redenumit/șters ulterior, date_vechi/date_noi ca
  jsonb, creat_la). SELECT doar pentru admin_central.
- `inregistreaza_activitate()` — funcție generică de trigger (SECURITY
  DEFINER, `set row_security = off` ca la `is_admin_central()`), folosește
  `TG_TABLE_NAME`/`TG_OP`/`auth.uid()` — un singur cod pentru toate
  tabelele, fără duplicare.
- Atașată pe 13 tabele „umane": `ferme`, `parcele`, `operatiuni`,
  `operatiuni_substante`, `substante`, `substante_nomenclator`, `utilaje`,
  `masini`, `alimentari_utilaje`, `rezervor_alimentari`,
  `cheltuieli_indirecte`, `curse`, `geofences`, `utilizatori`. EXCLUSE
  intenționat: tabelele populate automat de sincronizări/senzori (ex.
  `combustibil_citiri`, poziții Traccar) — volum mare, fără utilizator uman
  în spate, nu ce își dorea Radu aici. `substante_intrari` de asemenea
  exclusă — e deja propriul ei jurnal (are `introdus_de`).
- Frontend: `/jurnal-activitate` (admin_central only, link în meniu la
  Administrare) — filtrare pe tabel/utilizator/interval de date, paginare
  (50/pagină, „Încarcă mai multe"), fiecare rând expandabil arată diferența
  câmp cu câmp (valoare veche → nouă la UPDATE, sau valorile la
  INSERT/DELETE), nu doar JSON brut.

### 5t. Nomenclator substanțe într-un modal + corectare alimentări din istoric (2026-09-15)
Cerere Radu: lista de nomenclator (~35 substanțe) ocupa tot ecranul afișată
mereu; și-a dorit ascunsă după un buton, formatată frumos. Și la „Istoric
alimentări" a vrut posibilitatea să corecteze o alimentare introdusă greșit
(exemplul lui: Furnizor necompletat), nu doar furnizorul, ci orice câmp.

- **Nomenclator, în modal**: butonul „Vezi nomenclator (N)" deschide un
  panou peste pagină, cu câmp de căutare (filtrare live pe denumire) și
  tabel scrollabil Denumire / U.M. Lista mare nu mai aglomerează pagina
  principală.
- **Corectare alimentări** — buton „Corectează" pe fiecare rând din
  „Istoric alimentări" (doar admin general), deschide un formular inline cu
  Cantitate / Preț intrare / Dată / Furnizor / Notă. Fermă și substanța nu
  se pot schimba dintr-o corecție (ar însemna practic altă operațiune).
  - RPC nouă `editeaza_alimentare_substanta(...)` (admin_central only):
    actualizează rândul din `substante_intrari`, apoi cheamă
    `recalculeaza_stoc_substanta(substanta_id)`.
  - `recalculeaza_stoc_substanta` **reface stocul și prețul mediu de la
    zero**, reluând cronologic TOATE intrările + consumurile acelei
    substanțe (nu doar patch-uiește rândul corectat). Motiv: prețul mediu
    ponderat e dependent de ordinea exactă intrare/consum din timp (constatat
    din `scade_stoc_substanta_trigger`, care scade cantitatea la fiecare
    consum dar nu ajustează separat prețul) — o corecție a unei alimentări
    vechi trebuie să recalculeze tot ce a urmat, nu doar rândul respectiv,
    altfel prețul mediu curent ar rămâne greșit.
  - După orice corecție, stocul curent și prețul mediu afișate în pagină
    sunt exact ca și cum alimentarea ar fi fost introdusă corect de la
    început.

### 5u. Dropdown substanțe la operațiuni — doar stoc real al fermei, nu tot nomenclatorul (2026-09-15)
Cerere Radu: la înregistrarea unei operațiuni pe parcelă (ce a lucrat + ce
substanțe a folosit), adminul de fermă nu trebuie să poată alege din tot
nomenclatorul (36 de substanțe posibile), ci doar din ce există efectiv, cu
stoc > 0, pe gestiunea fermei lui.

- `components/ParcelaPanel.tsx`, `loadSubstante()`: interogarea pe tabela
  `substante` a fost restrânsă de la `ferma_id.eq.X SAU ferma_id.is.null`
  (clauza „is null" nu se mai potrivea oricum cu nimic în practică — fiecare
  rând din `substante` are ferma_id completat) la `ferma_id.eq.X ȘI
  stoc_curent > 0`. Rezultat: dropdown-ul din formularul de operațiuni arată
  strict substanțele din gestiunea fermei curente care mai au stoc fizic —
  nu tot nomenclatorul, și nici substanțele epuizate ale fermei.

### 5v. Comparație alimentări manuale (operator) vs realimentări detectate de sondă (2026-09-16)
Cerere Radu: pornind de la întrebarea „e nevoie ca operatoarea să înregistreze
manual alimentarea utilajelor, sau ne bazăm doar pe sonde?" — răspuns: mai
bine amândouă, comparate. Verificare făcută înainte de implementare:
`alimentari_utilaje` (înregistrarea manuală) exista deja ca tabelă + ecran
(`/alimentari-utilaje`), dar nu era folosită nicăieri în calculul rezervorului
central sau al costului de producție — practic aplicația funcționa deja doar
pe sonde, iar tabela manuală era aproape neutilizată (2 rânduri în total).
Separat, `get-combustibil-report` deja detecta realimentări din sondă (salturi
pozitive de nivel peste un prag, cu compresie în puncte de întoarcere ca să nu
"disperseze" o realimentare turnată treptat în mai mulți pași RS232) — deci
partea „automată" era deja construită, lipsea doar comparația cu manualul.

- `supabase/functions/get-combustibil-report/index.ts` (v6): pentru fiecare
  utilaj calibrat, se adaugă acum `manual_litri`/`manual_nr` (suma și numărul
  alimentărilor din `alimentari_utilaje` pentru acel utilaj, în aceeași
  perioadă selectată — 7/14/30 zile) și `diferenta_litri` = realimentat
  (sondă) − manual, plus `diferenta_semnificativa` (peste 15 l, același prag
  folosit și la detectarea evenimentelor). Utilajele necalibrate (fără sondă
  în litri) primesc și ele `manual_litri`/`manual_nr`, ca operatoarea să poată
  înregistra oricum, chiar dacă nu există sondă de comparat.
- `app/combustibil/CombustibilScreen.tsx`: două coloane noi în raport —
  „Manual (operator)" și „Diferență" (roșu + ⚠️ dacă diferența e
  semnificativă), cu o notă explicativă: diferență pozitivă = sonda a
  detectat mai multă motorină alimentată decât s-a raportat manual (posibil
  o alimentare uitată), negativă = manual > sondă (posibil cantitate greșită,
  sau — foarte rar, ~2% din cazuri pe fermele lui Radu — o alimentare dintr-o
  altă sursă decât rezervorul central).
- Nu s-a schimbat nimic la ecranul de înregistrare manuală (`/alimentari-utilaje`)
  — operatoarea continuă să introducă acolo ca până acum; comparația se vede
  doar în `/combustibil`, unde privește admin general.

*(Verificat ulterior, 2026-09-19: `tsc` compilează curat.)*

### 5w. Scăderi suspecte — prag calculat pe ore de FUNCȚIONARE, nu ore calendaristice (2026-09-19)
Cerere Radu: pragul vechi de „scădere suspectă" folosea orele calendaristice
dintre două citiri, ceea ce era greșit — un utilaj parcat 10 ore calendaristice
n-a ars nimic în tot intervalul ăla, dar modelul vechi îi „permitea" totuși să
piardă până la 150 l (10h × 15 l/h) fără să fie marcat suspect. Regulă corectă,
dată de Radu: dacă utilajul a stat staționat și nivelul a scăzut cât a stat
staționat, e clar suspect, indiferent de cât timp calendaristic a trecut —
pragul trebuie calculat pe orele în care a funcționat efectiv.

- `supabase/functions/get-combustibil-report/index.ts` (v7): pentru fiecare
  interval dintre două puncte de întoarcere (extreme), se calculează acum
  orele de funcționare din citirile BRUTE ale intervalului, cu aceeași
  convenție ca `get-utilaj-istoric-parcele` — pentru fiecare pas între două
  citiri consecutive, dacă citirea de la începutul pasului avea contact
  (ignition) pornit, pasul contează ca funcționare (plafonat la 1h per pas,
  ca un gol în date/device offline să nu fie citit greșit).
  - Pragul de scădere plauzibilă devine `max(15 l, 15 l/h × ore_funcționare)`
    — dacă orele de funcționare din interval sunt 0 (a stat parcat tot
    timpul), pragul se reduce la simplul prag minim de zgomot (15 l): orice
    scădere peste asta, cât timp a stat parcat, e suspectă.
  - Fallback: dacă utilajul n-are deloc semnal de contact înregistrat în
    interval (device mai vechi, fără ignition raportat din Traccar), se
    revine la orele calendaristice (comportamentul vechi), ca să nu marcăm
    totul suspect din lipsă de date.
- `app/combustibil/CombustibilScreen.tsx`: fiecare scădere suspectă din lista
  expandabilă arată acum și motivul — „utilaj staționat tot intervalul",
  „a funcționat Xh în interval", sau „fără date de contact — calculat pe timp
  calendaristic" — ca Radu să vadă direct de ce a fost marcată, nu doar cifra.
- Pragul de 15 l/h de consum „plauzibil" rămâne o valoare de pornire, nu
  calibrată pe consumul real al utilajelor lui Radu (care variază cu operația
  efectuată — încă necunoscut). De ajustat empiric pe măsură ce apar date.

### 5x. Activități pe parcele detectate automat din GPS — înlocuiește selecția manuală de parcelă (2026-09-19)
Cerere Radu: după discuția cu admin-ul fermei F1 Medgidia, adminii de fermă nu
mai trebuie să specifice manual în ce parcele au lucrat într-o zi — aplicația
știe deja asta din traseul GPS al utilajelor. Decizie explicită a lui Radu:
"munca fără utilaj nu există", deci coada de sesiuni detectate ÎNLOCUIEȘTE
complet pasul de selecție a parcelei (ParcelaPanel rămâne neschimbat, dar
folosit acum doar pentru istoric pe parcelă și corectări punctuale, nu ca flux
zilnic principal).

**Migrare** (`operatiuni_sesiune_detectata`): coloane noi, nullable, pe
`operatiuni` — `utilaj_id`, `sesiune_inceput`, `sesiune_sfarsit` — leagă o
operațiune de sesiunea GPS care a generat-o, pentru deduplicare la interogări
viitoare. Operațiunile vechi/manuale rămân cu aceste coloane null.

**`supabase/functions/get-sesiuni-detectate/`** (nou, deployed v1): pentru
fiecare utilaj activ al fermei, parcurge traseul brut din `combustibil_citiri`
(aceeași sursă ca `get-utilaj-istoric-parcele`/`get-combustibil-report`) și
formează segmente CONTINUE cu:
- motorul pornit (`contact = true`) pe toată durata — STRICT: dacă motorul se
  oprește în mijlocul unei prezențe pe parcelă, sesiunea se încheie exact
  acolo; o reluare ulterioară pe aceeași parcelă e o sesiune nouă, separată
  (decizia lui Radu — un utilaj parcat cu motorul oprit în câmp nu trebuie
  raportat ca "operațiune");
- poziția (point-in-polygon, aceeași logică de ray-casting ca
  `get-utilaj-istoric-parcele`) în interiorul UNEI SINGURE parcele;
- durată peste 10 minute (pragul cerut de Radu, ca să excludem simpla
  deplasare a utilajului traversând o parcelă).

O sesiune încă „în desfășurare" (nu s-a încheiat printr-o schimbare reală de
parcelă/contact până la ultima citire disponibilă) NU e raportată — evită
confirmarea unei sesiuni incomplete și o suprapunere parțială incorectă la
deduplicare. Sesiunile deja confirmate (transformate în `operatiuni` cu
`utilaj_id`+`sesiune_inceput`/`sesiune_sfarsit`) sunt excluse din rezultat.
Acces: admin_ferma vede automat doar sesiunile fermei lui (ferma_id dedus din
profil); admin_central trebuie să aleagă ferma explicit.

**`app/activitati-parcele/`** (nou): coadă de sesiuni neconfirmate, câte un
card per sesiune (utilaj, parcelă, interval orar, durată). Adminul alege doar
tipul de operațiune (dropdown, `TIPURI_OPERATIUNE`) și, dacă tipul e din
`TIPURI_CU_SUBSTANTE` (Suprainsamantare / Fertilizare-Tratamente), substanțele
folosite — dropdown filtrat pe stocul real al fermei (`stoc_curent > 0`),
exact același tipar ca `ParcelaPanel.loadSubstante` (secțiunea 5u). Orele de
lucru se precompletează din durata sesiunii (rotunjită la oră întreagă,
0-8h — constrângerea existentă pe `operatiuni.ore_lucru`), editabile de admin.
La „Confirmă": insert în `operatiuni` (cu `utilaj_id`/`sesiune_inceput`/
`sesiune_sfarsit` completate) + `operatiuni_substante`, exact ca la
înregistrarea manuală din ParcelaPanel — nicio funcție privilegiată nouă
pentru scriere, se bazează pe aceleași politici RLS care oricum permiteau deja
admin_ferma/admin_central să insereze operațiuni.
`components/LayoutShell.tsx`: link nou „Activități parcele" în meniu, vizibil
pentru admin_central + admin_ferma.

**Limitare cunoscută**: pragul de `ore_lucru` rămâne întreg (0-8), ca la
înregistrarea manuală — o sesiune de, de exemplu, 22 de minute rotunjește la
0h lucrate (dar tot apare în coadă, pentru vizibilitate; Radu poate ajusta
manual din formular înainte de confirmare). Dacă apare nevoia unei precizii
mai fine, `sesiune_inceput`/`sesiune_sfarsit` păstrează intervalul exact și
pot fi refolosite pentru un calcul mai precis mai târziu, fără migrare nouă.

**Notă pentru F1 Medgidia**: funcționează doar pentru ferme cu parcele care au
deja conturul desenat pe hartă (`poligon_harta`) — Radu a menționat că mai are
de configurat parcelele acolo; până atunci, `/activitati-parcele` arată un
mesaj explicit ("fermă fără parcele desenate"), nu o listă goală ambiguă.

### 5y. Consum zilnic per utilaj + red flag pe consum nejustificat de orele lucrate (2026-09-22)
Cerere Radu: vrea să vadă, per utilaj, cât a consumat în fiecare zi, și un
steag roșu automat când consumul nu e justificat de orele de funcționare din
ziua respectivă.

`supabase/functions/get-combustibil-report/index.ts` (v8): pe lângă
evenimentele izolate deja calculate (realimentări / scăderi suspecte), acum
se calculează și, per utilaj, un total de consum PE ZI (ziua locală România)
+ orele de funcționare din aceeași zi:
- `consumZilnicSiRedFlag()` reface, din aceleași citiri deja încărcate pentru
  utilajul respectiv (fără query suplimentar), două sume pe zi: litrii
  consumați (din intervalele dintre extreme, doar scăderile) și orele de
  funcționare (din citirile brute consecutive cu `contact=true`, aceeași
  convenție ca `get-utilaj-istoric-parcele` / secțiunea 5w).
- Fiecare interval se atribuie zilei locale a ÎNCEPUTULUI lui — o
  simplificare asumată: un interval care traversează miezul nopții se
  atribuie integral zilei de start, nu împărțit proporțional (aceeași
  simplificare ca la orele/zi din `get-utilaj-istoric-parcele`).
- Steag „nejustificat" pe zi, reutilizând EXACT pragurile deja stabilite cu
  Radu (secțiunea 5w), acum la nivel de zi întreagă, nu doar per eveniment:
  - ore funcționare = 0 ȘI consum > 15 L (prag de zgomot) → utilajul n-a
    funcționat deloc în ziua aia, dar nivelul a scăzut;
  - ore funcționare > 0 ȘI consum/oră > 15 L/h (prag plauzibil) → consumul nu
    se justifică prin cât a lucrat.
- E complementar cu „scăderi suspecte", nu duplicat: acolo se prinde un salt
  BRUSC izolat; aici se prinde și cazul unor scăderi mici, distribuite pe
  parcursul zilei, care per eveniment nu trec pragul, dar însumate pe zi
  depășesc consumul plauzibil pentru orele lucrate.
- Răspunsul per utilaj capătă `consum_zilnic: [{data, consum_litri,
  ore_functionare, consum_pe_ora, nejustificat}]` (sortat descrescător) și
  `zile_nejustificate` (număr, pentru sumar rapid).

`app/combustibil/CombustibilScreen.tsx`: coloană nouă „Consum zilnic
nejustificat" (numărul de zile flagged, roșu dacă > 0) în tabelul principal;
„Detalii" per utilaj arată acum și un tabel zi-cu-zi (zi, ore funcționare,
consum, consum/oră), cu rândurile nejustificate evidențiate roșu și motivul
afișat inline.

### 5z. Filtru dropout senzor combustibil — raport Steyr 4105 "de speriat" era fals (2026-09-22)
Radu a trimis screenshot cu raportul `/combustibil` pentru Steyr 4105 (Săbăreni):
2206.9L realimentat în 21 realimentări, 1930.3L "scăderi suspecte" în 18
evenimente, 5 zile marcate "nejustificat" cu rate de consum fizic imposibile
(până la 4739 L/h — un rezervor de 153L nu poate face asta). Întrebare: "verifică
dacă este adevărat".

**Verificare pe datele brute din `combustibil_citiri`** (utilaj_id
`8717c223-79ca-4a96-8ff9-e6a48e07d62e`, tanc 153L): senzorul DUT-E are
dropout-uri tranzitorii în care raportează 0L timp de câteva citiri consecutive
(secunde), apoi revine singur la nivelul dinainte. Exemplu găsit, care se
potrivește exact cu un eveniment din screenshot (21.09.2026, ora 10:36):
```
10:36:15  105.1L  contact=false
10:36:42    0.0L  contact=true   <- rafală de 6 citiri la 0L, 15 secunde
10:36:57    0.0L  contact=true
10:37:11  104.1L  contact=true   <- revine singur, 56s mai târziu
```
`extrageExtreme()` (algoritmul care comprimă citirile în puncte de întoarcere)
citea fiecare asemenea puseu ca o pereche reală "scădere suspectă" +
"realimentare", de zeci-sute de litri fictivi.

**NU e specific acestui utilaj.** Verificare pe toată flota (ultimele 10 zile,
citiri = 0L): John Deere 5403 — 5218/5378 (97%!), Belarus 1523.3 — 4323/13723
(31%), Steyr 4105 — 2411/15233 (16%), Steyr 4100 Kompakt — 465/4341 (11%), și
alte câteva utilaje cu procente mai mici. E o problemă sistemică de telemetrie
(senzor DUT-E și/sau lanțul Traccar → `sync-traccar-fuel`), nu un caz izolat.

**Fix (`get-combustibil-report` v9)**: funcție nouă `eliminaDropoutTranzitoriu`,
aplicată pe citiri ÎNAINTE de `extrageExtreme()`. Regulă: o rafală de citiri
≤5L se elimină complet din calcul DOAR dacă citirea de dinainte și prima
citire de după rafală sunt apropiate (diferență ≤15L) și la mai puțin de 5
minute distanță ("revine la fel", deci dropout, nu rezervor gol real). Dacă
rezervorul chiar rămâne gol (nu revine în 5 minute, sau nu există citire de
comparat înainte/după), citirile NU se elimină — nu vrem să ascundem un
rezervor cu adevărat gol sau un furt real doar pentru că seamănă parțial cu
tiparul de dropout.

Verificat după deploy: pe zilele problematice (21-22 Sept), după eliminarea
rafalelor de dropout, nivelurile rămase pentru Steyr 4105 sunt toate în banda
plauzibilă 66-159L (sub capacitatea de 153×1.05=160.65L) — fără citiri
aproape-zero izolate rămase.

**Aplicabilitate**: fix-ul e local în `get-combustibil-report` (evenimente +
consum zilnic/red-flag, secțiunea 5y). `get-sesiuni-detectate` și
`get-utilaj-istoric-parcele` (secțiunea 5x) NU sunt afectate de acest bug —
folosesc poziția GPS (lat/lon) și `contact`, nu `nivel_litri`, din aceleași
citiri brute.

**Răspuns către Radu**: raportul arătat NU reflectă furt sau consum real —
e artefact de telemetrie. Numerele corectate (după fix) sunt de încredere;
dacă apar în continuare zile/evenimente marcate suspecte după acest fix, ele
merită investigate ca reale.

### 5aa. Filtru zgomot senzor combustibil, v2 — generalizat (2026-09-22)
Continuare a secțiunii 5z. Radu a arătat cu Traccar Replay că utilajul Steyr
4105 chiar lucra masiv în perioadele marcate "suspecte" de v9 — deci volumul
mare de citiri NU era semnul problemei (corectare adusă în conversație, nu
doar în cod). Investigând mai departe pe raportul live, tot pe Steyr 4105,
au ieșit la iveală DOUĂ tipare de zgomot distincte, nu unul:

**(a) Excursii de amplitudine mare, nu doar spre 0** — pe 15-16.09.2026,
senzorul a produs citiri haotice pe o plajă largă (0L, dar și 53.7, 107.4,
121.3, 137.8L — plus valori peste capacitate, deja eliminate de filtrul de
capacitate) timp de peste 2 ore, fiecare revenind rapid (secunde până la ~9
minute) la nivelul dinainte. Filtrul v9, limitat strict la citiri ≤5L, nu
prindea excursiile mai mari (ex. 121.3L), care „contaminau" ancora folosită
pentru verificarea rafalelor de 0 învecinate — motiv pentru care raportul tot
arăta evenimente fictive (`-121.3L`, `+53.7L`, `-107.4L`, `+107.4L`...) chiar
și după fix-ul din 5z, exact la orele 17:23-17:46 din 15.09, confirmate de
Radu ca fiind reale mișcări GPS ale utilajului, nu perioade suspecte.

**(b) Zgomot fin, continuu (1-8L), care nu revine niciodată complet** — o
oscilație lentă în jurul unei valori, prezentă chiar și cu utilajul staționat
(contact=false) — vizibilă pe 17.09.2026 ora 07:25-07:45, unde nivelul
fluctuează ±1-5L la fiecare câteva secunde fără nicio activitate a
motorului. Fiecare pas individual e sub pragul de eveniment (15L), deci
algoritmul vechi de extrase-extreme (fără histerezis) trata FIECARE inversare
ca o schimbare reală de direcție — iar `consumZilnicSiRedFlag` aduna fiecare
scădere, oricât de mică, fără să scadă urcările simetrice care o compensau.
Pe o zi cu mii de citiri, sutele de asemenea oscilații mici se adună fals la
sute de litri "consumați" (exact tiparul raportat: 292.6L în doar 1.3h ore
reale de funcționare, pe un rezervor de 153L).

**Fix (`get-combustibil-report` v10)**:
- `eliminaFluctuatiiTranzitorii` (generalizare a `eliminaDropoutTranzitoriu`
  din v9): verifică "revine la loc" pentru ORICE salt peste
  PRAG_MINIM_EVENIMENT_L (15L), nu doar pentru valori ≤5L; fereastra de timp
  a fost lărgită de la 5 la 15 minute, pe baza golului real de ~9 minute
  observat între citiri plauzibile în timpul unei rafale de zgomot.
- `extrageExtreme` rescris cu HISTEREZIS (algoritmul clasic "zigzag" de
  detecție a extremelor pe semnale zgomotoase): un nou punct de întoarcere se
  confirmă doar când seria inversează cu cel puțin PRAG_ZGOMOT_L (5L) față de
  candidatul curent — o oscilație mai mică nu mai fragmentează seria în
  extreme false.

Cele două fixuri sunt complementare: (a) prinde salturile mari care revin
(rafale/excursii izolate de amplitudine mare), (b) prinde zgomotul mic
continuu care nu revine niciodată dar nici nu reprezintă o tendință reală.
Trasat manual pe date reale (SQL) pentru ambele cazuri raportate de Radu
înainte de deploy — verificare vizuală, nu doar teoretică.

**Notă pentru viitor**: dacă apar în continuare rapoarte "de speriat" pe alte
utilaje, primul pas e tot verificarea manuală pe `combustibil_citiri` brut —
tiparul de zgomot pare specific senzorului DUT-E/lanțului Traccar și posibil
prezent, în grade diferite, pe toată flota (vezi 5z pentru procentele pe
utilaj).

### 5ab. Semnalul de contact e nesigur — orele de funcționare completate cu mișcare GPS (2026-09-22)
Continuare a secțiunilor 5z/5aa. După fixurile de zgomot pe `nivel_litri`,
raportul pentru Steyr 4105 tot arăta rate "peste plauzibil" (81-203 L/h) pe
zile în care Radu a confirmat că utilajul chiar lucra ore întregi ("azi nu
cred ca a furat cineva motorina, probabil asta e consumul normal al
utilajului in sarcina"). Root cause, GĂSIT DIFERIT de zgomotul pe combustibil:
**semnalul de `contact` (ignition) e el însuși nesigur** pe acest lanț de
telemetrie — verificare SQL pe 18.09.2026, 05:00-13:00 UTC: utilajul a avut
sute de poziții GPS distincte pe oră (mișcare reală, continuă — confirmată și
de Radu cu Traccar Replay) dar `contact=true` apărea în doar câteva citiri pe
oră, uneori deloc într-o oră întreagă cu 47 de poziții diferite. Rezultat:
orele calculate DOAR din contact (0.72h acea zi) erau de ~7.5x mai mici decât
orele reale de funcționare (5.47h, calculate incluzând mișcarea GPS) — ceea
ce umfla artificial rata L/h calculată (141.8L / 0.72h = 202 L/h fals, vs.
141.8L / 5.47h ≈ 26 L/h, plauzibil pentru un tractor sub sarcină).

**Fix (`get-combustibil-report` v11)**: un pas între două citiri brute
consecutive contează acum ca funcționare dacă ORICARE dintre semnale o
confirmă — `contact=true` SAU utilajul s-a deplasat ≥20m între cele două
citiri (`intervalInFunctionare`, distanță aproximată prin proiecție plană
simplă). Aplicat atât la clasificarea evenimentelor (scădere suspectă vs.
normală) cât și la calculul orelor din consumul zilnic. Interfața `Citire` +
query-ul au fost extinse cu `latitudine`/`longitudine` (fetch-uite deja de la
`combustibil_citiri`, doar nefolosite până acum în acest raport).

**Notă importantă, NEREZOLVATĂ încă**: același semnal de `contact` e folosit
STRICT (fără fallback pe mișcare) în `get-sesiuni-detectate`
(activități-parcele, secțiunea 5x) — decizia lui Radu a fost explicit "Da,
strict" pentru contact=true pe toată durata unei sesiuni detectate. Dacă
`contact` flichează fals în timpul lucrului real (exact tiparul găsit aici),
e posibil ca sesiunile GPS detectate acolo să fie fragmentate incorect sau
chiar pierdute (sesiune sub pragul de 10 minute din cauza unei întreruperi
false de contact în mijlocul lucrului real). NU s-a investigat/corectat încă
— necesită o decizie separată a lui Radu, pentru că "strict contact" a fost
ales intenționat ca să excludă exact cazul opus (utilaj remorcat/mutat cu
motorul oprit). O eventuală relaxare (contact SAU mișcare) ar trebui
cântărită cu grijă față de acel risc.

### 5ac. get-sesiuni-detectate v2 — fallback pe mișcare GPS, sub observație până la 1 octombrie (2026-09-22)
Continuare directă a secțiunii 5ab: aceeași instabilitate a semnalului
`contact` găsită la `get-combustibil-report` afecta și `get-sesiuni-detectate`
(coada „Activități parcele", secțiunea 5x), care folosea `contact=true`
STRICT pe toată durata unei sesiuni.

**Cuantificare pe Săbăreni (10 zile, utilaje cu parcele desenate)**: am
reconstruit „rulajele" de `contact=true` așa cum le vede algoritmul. Pentru
Steyr 4105: 1766 rulaje candidate, din care 1760 (99.7%) sub pragul de 10
minute cerut de Radu — dispar tăcut din coadă; rămân doar 6 sesiuni
raportabile, însumând 11.8h din 10 zile, deși utilajul a lucrat continuu ore
în șir în zile individuale (confirmat separat prin Traccar Replay, secțiunea
5aa). Verificare pe restul flotei din Săbăreni a arătat același tipar, cu
severitate diferită per utilaj (de la aproape total-nefuncțional, ca Steyr
4105, la doar parțial afectat, ca Belarus 1523.3) — corelat cu problema deja
cunoscută de fiabilitate a senzorului (secțiunea 5z).

**Fix (`get-sesiuni-detectate` v2)**: adăugat `intervalInFunctionare()`,
identic cu cel din `get-combustibil-report` v11 — un interval contează ca „în
funcțiune" dacă `contact=true` LA ÎNCEPUT SAU utilajul s-a mișcat efectiv
≥20m (`PRAG_MISCARE_METRI`) până la citirea următoare. Garda inițială a lui
Radu (un utilaj parcat cu motorul oprit nu trebuie să apară ca „operațiune")
rămâne valabilă: fără mișcare reală ȘI fără contact, intervalul tot nu
contează. Rămâne o mențiune cunoscută: un utilaj REMORCAT cu motorul oprit
poate trece pragul de mișcare — același compromis deja acceptat la v11.

**Decizie Radu**: algoritmul (v2) rămâne SUB OBSERVAȚIE până pe 1 octombrie
2026 — se urmăresc sesiunile produse (`/activitati-parcele`) pentru eventuale
anomalii (sesiuni greșit atribuite, falsuri din remorcare, parcele greșite
etc.) înainte de decizia finală: rămâne așa sau se mai ajustează.

**Notă tehnică**: `get-sesiuni-detectate` nu exista în `supabase/functions/`
din repo (fusese livrat direct pe Supabase, fără commit, la 5x) — codul
curent (v2) a fost adus acum în git odată cu acest fix.

### 5ad. get-combustibil-report v12 — eliminare steaguri roșii, consum mediu ponderat, teste până la 30 septembrie (2026-09-22)
Continuare directă a 5aa/5ab: chiar și după v11, rămâneau zile flagged „peste
consumul plauzibil" (20-26 L/h) pe un prag fix (`MAX_PLAUSIBLE_CONSUM_L_PE_ORA
= 15 L/h`) ales fără date reale. Am verificat traseul GPS (aceleași citiri
sincronizate din Traccar) pentru Steyr 4105 pe zilele flagged (17, 18, 21, 22
sept.) — utilajul chiar lucra extensiv (40-55 km/zi, 800-900 poziții GPS
distincte), consumul nu era artefact, doar pragul era prea conservator pentru
un utilaj de talia asta sub sarcină grea.

**Decizie Radu**: „nu stiu cum trebuie facut" — deci, până avem date reale
suficiente, s-a eliminat complet logica de steag roșu bazată pe
`MAX_PLAUSIBLE_CONSUM_L_PE_ORA` (constanta rămâne în cod doar ca referință
istorică, nefolosită). Perioadă de TESTE până pe 30 septembrie 2026: se strâng
date reale de consum per utilaj, apoi se decide un prag calibrat (posibil
per-utilaj), nu o presupunere.

**Fix (`get-combustibil-report` v12)**:
- `consum_zilnic` (per zi) nu mai are `nejustificat` — doar cifrele brute
  (ore funcționare, consum, consum/oră). O zi cu 0 ore de funcționare rămâne
  cu `consum_pe_ora: null` (nu se calculează nimic, cerința explicită a lui
  Radu).
- `scaderi_suspecte` → redenumit `scaderi_mari`, clasificare pe prag FIX
  (>15L), nu mai depinde de rata L/h — listă informativă, fără stilizare
  roșie în UI.
- Nou câmp per utilaj: `consum_mediu_ponderat_l_pe_ora` = suma consumului pe
  zilele cu ore de funcționare > 0, împărțită la suma acelorași ore (zilele
  cu 0 ore nu participă la calcul — evită împărțirea la zero și distorsiunea
  mediei). null dacă utilajul n-a funcționat deloc în perioadă. Asta e
  cifra pe care mergem mai departe, per Radu.
- Singurul steag rămas activ în raport: diferența manual vs sondă
  (`diferenta_semnificativa`) — nu depinde de pragul de plauzibilitate în
  discuție, rămâne o verificare încrucișată validă.

`CombustibilScreen.tsx`: coloana „Consum zilnic nejustificat" → „Consum
mediu (L/h)" (afișează `consum_mediu_ponderat_l_pe_ora`); coloana „Scăderi
suspecte" → „Scăderi mari", fără roșu/⚠️; rândul din tabelul principal nu
mai e evidențiat roșu; tabelul zi-cu-zi din „Detalii" arată doar cifrele,
plus o linie cu media ponderată a perioadei. Textul explicativ de sus a fost
actualizat să menționeze perioada de teste.

**Următorul pas** (nefăcut încă): pe la 30 septembrie 2026, cu date reale
adunate, se decide un prag de plauzibilitate calibrat pe consumul mediu
ponderat real al fiecărui utilaj — posibil diferit per utilaj, nu un singur
prag fix pentru toată flota.

### 5ae. get-combustibil-report v13 — bug de atribuire pe zi + optimizare CPU (2026-09-23)
Radu a semnalat un caz absurd în raport: utilajul Belarus 1523.3 0227
(Săbăreni) apărea pe 19 septembrie cu „0.3h funcționare, 69.5L consum,
231.7 L/h" — evident imposibil pentru un motor Diesel.

**Root cause (confirmat prin reconstrucție Python bit-cu-bit a algoritmului
v12, pe datele brute din `combustibil_citiri`)**: NU e o problemă de senzor.
E un bug de ATRIBUIRE PE ZI. Un interval extremă-la-extremă poate acoperi mai
multe zile (gol de date, senzor „înțepenit" ore în șir etc.) — în cazul
semnalat, o scădere de -69.5L s-a întins din 19 septembrie 14:38 (ora
României) până în 22 septembrie 08:40. `consumZilnic` (v12) punea TOT
consumul intervalului pe ziua lui de ÎNCEPUT (19 sept), în timp ce orele de
funcționare erau (corect) distribuite zi cu zi din citirile brute — pe 19
sept au căzut doar 0.3h din cele 6.5h ale intervalului, restul pe 21-22 sept,
unde utilajul chiar a lucrat ore în șir. De-aici raportul absurd de 231.7 L/h
pe o zi cu aproape zero activitate.

Important: **media ponderată pe toată perioada NU era afectată** (aceiași
litri, aceleași ore, doar atribuite pe zile greșite în tabelul zilnic) — doar
detalierea pe zi arăta greșit.

**Fix (v13)**: `consumZilnic` distribuie acum scăderea fiecărui interval
PROPORȚIONAL cu orele de funcționare ale fiecărei zile ÎN ACEL interval (nu
mai integral pe ziua de start). O zi fără nicio oră de funcționare în
interval nu mai primește nimic din consum. Verificat pe cazul semnalat: 19
septembrie scade de la 69.5L/231.7 L/h la ~3L/~12 L/h, iar cea mai mare parte
din cele 69.5L se mută pe 21-22 septembrie.

**Bonus găsit în aceeași investigație — bug de disponibilitate**: în logurile
funcției (`mcp__Supabase__query_logs`, `source = 'function_logs'`) apăreau
erori intermitente `"CPU Time exceeded"` (~2043ms folosiți dintr-un buget
~2000ms), cauzând răspunsuri HTTP 546 și mesajul generic „Eroare la
încărcarea raportului." văzut de Radu prin screenshot. Suspect principal:
`ziuaLocala()` recrea `Intl.DateTimeFormat` (construcție scumpă) la FIECARE
apel, deși se cheamă de mii de ori per cerere, pe toată flota calibrată.
Scos formatter-ul o singură dată la nivel de modul (v13) — comportament
identic, mult mai ieftin de rulat. Neconfirmat 100% ca soluție completă —
de urmărit dacă mai reapare eroarea.

### 5af. get-combustibil-report v14 — interval custom + context calibrare sonde (2026-09-23)
Continuare directă a 5ae: la verificarea pe toată flota (16 utilaje, 14 zile),
câteva utilaje arătau L/h zilnic complet imposibil (Faresin FH 2500: 730 L/h
într-o zi; Solis S26+: 250 L/h; Bobcat S250: 39.6 L/h mediu). Radu a explicat
cauza reală: **săptămâna 14–21 septembrie 2026 s-a calibrat sonda pe fiecare
utilaj pe rând** (ultimul, John Deere, luni 21 sept) — procedura umple
rezervorul în pași cunoscuți (ex. câte 10L) cu utilajul STAȚIONAT, ceea ce
generează exact tiparul găsit (salturi mari, repetate, la valori rotunde). NU
e un bug de algoritm — e perioada de calibrare amestecată cu funcționarea
reală. Utilajele Autostack, Belarus 1221.3, Korea MT3.50 și Bobcat S250 nu
s-au mișcat deloc de la calibrare încoace.

**Verificare**: am reluat analiza fleet-wide restrângând la 22 septembrie
încoace (excluzând perioada de calibrare) — toate cazurile anterior absurde
dispar sau devin plauzibile (Faresin FH 2500: 3.2 L/h în loc de 730; Solis,
Bobcat, Autostack, Belarus 1221.3, Korea: fără date noi de la calibrare —
confirmă că n-au fost mișcate). Singura excepție notabilă: **Faresin FR02**
rămâne cu cifre mari (30.3 L/h mediu, vârf 57.6 L/h) chiar și după 22
septembrie — NU explicat de calibrare, de verificat separat (posibil consum
real mare sub sarcină, ca la Steyr 4105 — vezi 5x/5aa — sau o problemă
distinctă).

**Fix (v14) — interval custom în raport**: în loc să ștergem istoricul brut
din `combustibil_citiri` (rămâne util ca audit al calibrării), raportul
primește acum un interval CUSTOM ales dintr-un calendar (`de_la` + opțional
`pana_la`, zile calendaristice România, gestionate corect indiferent de ora
de vară/iarnă), pe lângă presetul „Ultimele N zile". UI: două `<input
type="date">` + buton „Aplică" în `CombustibilScreen.tsx`, cu o notă
explicativă despre perioada de calibrare și recomandarea de a alege 22
septembrie încoace pentru cifre de încredere.

### 5ag. Pagină nouă „Realimentări utilaje" — comparație sondă vs manual pe o zi aleasă (2026-09-23)
După ce am scos coloanele Manual/Diferență din `/combustibil` (Radu: raportul
se bazează doar pe sondă), Radu a cerut un instrument separat pentru
verificare punctuală: un buton unde alege o dată și scoate un raport doar cu
realimentările acelei zile, ca să compare cu ce a înregistrat operatoarea.

Pagină nouă `/realimentari-utilaje` (admin_central, link în meniu lângă
Combustibil): un `<input type="date">` + buton „Generează raport", care
afișează două liste una lângă alta pentru ziua aleasă —
- **Detectate de sondă**: reutilizează `get-combustibil-report` (v14, interval
  custom `de_la=pana_la=<ziua aleasă>`), extrăgând doar `realimentari` din
  fiecare utilaj.
- **Înregistrate manual**: interoghează direct `alimentari_utilaje` pentru
  aceeași fereastră de timp (limitele zilei interpretate în fusul orar al
  browserului, la fel ca la înregistrarea manuală).

Fără diff automat — e o verificare vizuală, punctuală, nu un steag (consistent
cu decizia de a nu mai calcula automat diferența sondă-manual).

### 5ah. get-combustibil-report v15 — bilanț de masă în loc de sumă pe extreme (2026-09-23)
Radu a semnalat: Faresin FR02 (Săbăreni), 22 septembrie — „a funcționat 8.7h,
cu un consum de 25.6L/h, doar că nu are rezervor de 222 litri, nu apare
realimentare". Corect observat: 8.7h × 25.6L/h ≈ 223L, imposibil pentru un
tanc de 120L fără o realimentare în ziua respectivă — și totuși niciuna nu
apărea în listă.

**Anchetă** (citiri brute 21-23 sept, replicat exact algoritmul deployat):
nivelul acestui senzor oscilează continuu cu 5-14L în sus și în jos (probabil
sloshing/vibrație — nu e tiparul de calibrare de la 5af, nici dropout-ul de la
5z) — sub pragul de 15L de eveniment. Consecință directă a modului în care
calcula `consumZilnic`: fiecare mică SCĂDERE dintre extreme (chiar 5-6L) se
aduna integral ca și consum, dar mica CREȘTERE care o urma imediat (sloshing-ul
revine) nu ajungea niciodată la pragul de 15L ca să fie recunoscută drept
realimentare — deci era pur și simplu ignorată. Rezultat: zgomotul care se
anula practic singur pe parcursul zilei era numărat ca și consum de-a lungul
întregii lui amplitudini, de multe ori la rând.

Cifre concrete, 22 septembrie: suma tuturor scăderilor dintre extreme = 222.7L
(cifra din raport) — dar nivelul măsurat efectiv a scăzut cu doar **10.5L**
între prima citire a zilei (45.1L, 08:10) și ultima (34.6L, 19:27). Pe tot
intervalul 21-23 sept: suma scăderilor între extreme = 568.9L, suma
creșterilor = 531.7L — aproape egale, deci aproape tot ce se aduna ca
"consum" era de fapt zgomot care se compensa singur, nu combustibil ars.

**Fix**: consumul (atât pe zi cât și pe toată perioada cerută) nu se mai
calculează însumând fiecare scădere extremă-la-extremă, ci prin BILANȚ DE
MASĂ — nivelul primei citiri minus nivelul ultimei citiri (al zilei / al
intervalului), plus realimentările confirmate (≥15L) petrecute în acel
interval. Complet imun la orice amplitudine de zgomot sub pragul de
realimentare, pentru că ignoră traseul dintre cele două capete și contează
doar ce s-a măsurat efectiv la capete. Verificat pe cazul semnalat: 22
septembrie scade de la 222.7L/25.6 L/h la **10.5L/~1.2 L/h** — plauzibil
pentru acest utilaj. Pe 21 septembrie (zi cu o realimentare reală de 16.2L
confirmată) rezultă 35.6L consumate, pe 23 (fereastră parțială de date,
doar până la 10:13) 25.8L, inclusă o realimentare de 15.2L.

Efect secundar, intenționat: o scădere mare (`scaderi_mari`, >15L) intră acum
și ea în consumul total — înainte era exclusă din `consum_normal_litri`,
tratată doar informativ. Corect așa, fizic reprezintă combustibil scăzut real
din rezervor; rămâne vizibilă separat, pentru control, în caz că era o eroare
de senzor și nu consum real.

**Notă operațională**: acest bug de dublă numărare a zgomotului nu e limitat
la Faresin FR02 — poate afecta (mai discret, cu amplitudini mai mici) orice
utilaj cu senzor mai zgomotos decât pragul de 5L de histerezis. Bilanțul de
masă din v15 elimină problema pentru toată flota, nu doar pentru cazul
semnalat.

**Notă separată, găsită cu ocazia asta**: fișierul `index.ts` din git nu avea
de fapt schimbările de backend din v14 (interval custom) — commit-ul `5061a41`
a inclus doar `CombustibilScreen.tsx` și `NOTES.md`, funcția fusese deployată
direct în Supabase fără să ajungă și în repo. Commit-ul de acum include atât
codul v14 lipsă din git, cât și fix-ul v15 de mai sus, ca să rămână
sincronizate.

### Foi de parcurs redesenate + separare navigare flotă/utilaje (2026-09-23)

Radu a atașat raportul PDF „Foaie de parcurs" al firmei care monitoriza
flota auto înainte de a trece pe aplicația proprie (AROBS Track GPS), ca
inspirație, și a cerut (1) o separare clară în navigare/UI între flota de
mașini și utilaje, și (2) un raport de foaie de parcurs mai bun — fie ca cel
AROBS, fie o propunere proprie.

**Decizii confirmate de Radu** (3 întrebări):
- Adrese pe traseu: DA, via geocodare gratuită (Nominatim/OpenStreetMap).
- Rezumat flotă: DA — pagină de rezumat lunar (toate mașinile) + detaliu
  per mașină (ca înainte).
- Separare navigare: pagină proprie „Flotă auto" cu carduri, nu meniu
  expandat.

**Adrese pe traseu — `sync-traccar-masini` v2**: la momentul în care o
cursă pornește (INSERT) și la momentul în care se închide prima dată
(`data_ora_stop` trece din NULL în nenul), se face o geocodare INVERSĂ
(coordonate → adresă text) prin Nominatim (gratuit, OpenStreetMap) și se
salvează în `curse.adresa_pornire` / `curse.adresa_sosire`. O singură dată
per capăt de cursă, nu recalculat la fiecare rulare de cron cât cursa e
încă deschisă. Respectă politica de utilizare Nominatim (~1 cerere/secundă,
User-Agent obligatoriu) — volum mic (câteva curse finalizate per rulare de
5 min), deci throttling-ul e neglijabil. Eșec de geocodare → NULL, nu
blochează salvarea cursei; UI arată „—". Coloane noi pe `curse`:
`adresa_pornire`, `adresa_sosire` text, plus `latitudine_start`/
`longitudine_start` numeric (rețin capătul de plecare al unei curse încă
deschise, ca funcția să nu recitească tot lanțul de poziții la fiecare
rulare doar ca să afle unde a pornit).

**„Km cumulat"**: pe foaia de parcurs detaliată (`get-foaie-parcurs` v2),
fiecare cursă arată acum și suma GPS a tuturor curselor mașinii de la
începutul monitorizării, până la și inclusiv cursa respectivă. Explicit
NU e un odometru real — n-avem integrare hardware pentru asta — e un reper
relativ, calculat strict din traseele GPS. Etichetat clar așa în UI.

**Rezumat flotă — funcție nouă `get-rezumat-flota`**: un rând per mașină
activă (nume, nr. înmatriculare, total km, număr curse, număr nevalidate)
pentru luna cerută. Devine ecranul implicit al paginii `/foi-parcurs`;
„Vezi foaia de parcurs" pe un rând trece la foaia detaliată a mașinii
respective (fost singurul mod de a vedea raportul).

**Separare navigare — pagină `/flota-auto`**: pagină de start cu carduri
(Mașini, Curse, Foi de parcurs, Alerte, Zone), rol-aware — admin_ferma vede
doar Mașini + Curse (ca și înainte), admin_central vede tot. În
`LayoutShell.tsx`, secțiunea „Flotă auto" din meniu (care avea legături
individuale către Mașini/Curse/Foi de parcurs/Alerte) devine un singur link
către `/flota-auto`. Legătura separată „Zone" din secțiunea „Administrare"
a fost eliminată din meniu — Zone (geofences) e fleet-specific (folosit
doar pentru alertele mașinilor), acum accesibil doar prin cardul din
`/flota-auto` (admin_central).

**Migrații aplicate live** (`curse_adresa_pornire_sosire`,
`curse_coordonate_start`): adaugă cele 4 coloane de mai sus pe `curse`. La
momentul aplicării, tabelul `curse` era complet gol (0 rânduri) — nu a fost
nevoie de backfill.

**Funcții deployate**: `sync-traccar-masini` v2, `get-foaie-parcurs` v2,
`get-rezumat-flota` (nouă) — toate verificate cu `get_edge_function` după
deploy, conținutul livrat corespunde exact cu sursa intenționată.

### Flotă auto (mașini de pasageri) — modul complet construit (2026-08-27)
Scop: doar foi de parcurs (trip logs) + geofencing/alerte viteză, fără
monitorizare combustibil, fără abonament la alt provider GPS — reutilizează
Traccar-ul existent (http://135.181.45.175/).

**Hardware**: 25x Teltonika FMC130 + 25x SIM-uri de date, deja achiziționate.
- Opțiuni comparate: FMC920 (cel mai simplu/ieftin, suficient pentru tracking + foi de
  parcurs), FMC130 (intrări/ieșiri configurabile în plus, input negativ, input impuls),
  FMC125 (cel mai avansat, RS232/RS485 — nefolosit aici, gândit pentru senzori externi).
- **Decizie finală: FMC130** — motiv: preț bun (50 EUR/buc în România), consultanță și
  garanție locală incluse. Se configurează identic în Traccar (IMEI + device nou),
  funcționează la fel pentru rapoarte de traseu.

**Decizii de flux** (stabilite cu Radu înainte de implementare):
- Curse detectate **automat** din segmente ignition on/off (ca orele de funcționare
  de la utilaje) — șoferul NU pornește/oprește manual nimic.
- Km oficiali = calculați automat din traseul GPS (haversine cumulat), nu introduși
  manual de șofer.
- Fiecare mașină are un **șofer implicit** (`masini.sofer_implicit_id`), editabil din
  `/masini` — cursele noi se atribuie automat lui la detectare.
- Flotă alocabilă pe ferme (**2026-08-28**, revizuit — inițial gândită ca flotă
  centrală, schimbat la cererea lui Radu): `masini.ferma_id`, opțional — o
  mașină nealocată rămâne în „pool central" (vizibil doar admin_central).
  Admin_central face alocarea din `/masini`. Rolul **admin_ferma existent**
  (cel de pe parcele/utilaje/substanțe) e reutilizat — nu s-a creat un rol
  nou — și vede DOAR mașinile fermei lui, fără hartă live, fără editare;
  poate doar introduce **bonuri de combustibil** (tabelul nou
  `bonuri_combustibil_masini`: dată, litri, preț/litru, sumă totală, stație,
  km la bord, notă) pentru mașinile fermei lui, din același `/masini`.

**Schema** (`supabase/schema-masini.sql`, aplicată direct prin Supabase MCP):
tabele noi `masini`, `masini_pozitii`, `curse`, `geofences`, `alerte` + RLS
(admin_central vede/gestionează tot; rolul nou `sofer` vede/completează doar
cursele proprii, cu politică UPDATE care blochează modificarea după ce admin
setează `status = 'validata'`). Rolul `sofer` nu are constrângere CHECK în
bază (coloana `utilizatori.rol` e text liber, ca și până acum) — validat doar
în `admin-create-user` și în formularul din `/utilizatori`. **2026-08-28**:
migrația `flota_masini_alocare_ferme_si_bonuri_combustibil` a adăugat
`masini.ferma_id` (nullable, FK spre `ferme`) și tabelul
`bonuri_combustibil_masini` (RLS: admin_central gestionează tot; admin_ferma
vede/adaugă bonuri doar pentru mașinile fermei lui, editează/șterge doar
bonurile introduse chiar de el).

**Edge Function `sync-traccar-masini`** (cron, 5 min, `verify_jwt: false` —
la fel ca `sync-traccar-fuel`): într-o singură rulare — (1) sincronizează tot
istoricul de poziții noi din Traccar (aceeași strategie „from ultima citire
salvată" ca la utilaje, nu doar poziția curentă), (2) detectează curse din
segmentele ignition on/off și le ține „deschise" (`data_ora_stop = NULL`,
km actualizat progresiv) cât timp contactul rămâne pornit, (3) detectează
alerte de viteză (`masini.viteza_limita_kmh`, doar pe front crescător — nu
spamează la condus continuu peste limită) și de geofencing (ray-casting,
aceeași funcție ca `get-utilaj-istoric-parcele`, pe tabelul nou `geofences`).
Curse sub 60s ȘI sub 50m sunt considerate zgomot de contact și șterse automat.

**Alte Edge Functions noi**: `get-masini-positions` (hartă live `/masini`,
analog `get-utilaje-positions` dar cu viteză + cursă activă în loc de
combustibil), `get-foaie-parcurs` (date pentru raportul lunar per mașină,
`/foi-parcurs`). `admin-create-user` actualizată să accepte rolul `sofer`.

**Cron**: `sync-traccar-masini-5min` (`supabase/schema-cron-sync-traccar-masini.sql`),
aceeași formulă `net.http_post` + `app.settings.anon_key` ca la utilaje.

**Pagini noi**:
- `/masini` — pagină unică, două randări după rol (fără `AdminCentralGuard` în
  layout — control de acces în `MasiniScreen.tsx` + RLS, la fel ca `/curse`):
  - **admin_central**: listă + hartă live (`components/MasiniMapView.tsx`,
    analog `UtilajeMapView.tsx`) + formular adăugare mașină (nume, nr.
    înmatriculare, IMEI, șofer implicit, **fermă** — opțional, pool central
    dacă necompletat —, limită viteză) + editare inline per mașină (inclusiv
    realocare fermă).
  - **admin_ferma**: listă simplă a mașinilor alocate fermei lui (fără hartă,
    fără editare) + formular „Adaugă bon de combustibil" (mașină, dată,
    litri, preț/litru, sumă totală, stație, km la bord, notă) + istoric
    bonuri recente ale fermei.
- `/curse` — pagină unică, două randări după rol (fără `AdminCentralGuard` în
  layout, control de acces în `CurseScreen.tsx` + RLS): șofer vede carduri
  mobil-first cu formular de scop; admin vede tabel per mașină cu buton
  „Validează".
- `/foi-parcurs` (admin_central) — alege mașină + lună, generează tabel
  printabil (CSS `@media print`, fără dependință nouă de PDF — „Printează /
  Salvează PDF" e `window.print()`). **Nu e un formular fiscal oficial** —
  obligativitatea unui format anume de foaie de parcurs pentru deducere TVA a
  fost relaxată de ANAF; layout-ul acoperă câmpurile standard (dată, interval
  orar, șofer, scop, km, total), de confirmat cu contabilul dacă e nevoie de
  altceva.
- `/geofences` (admin_central) — desenare zone pe hartă (poligon prin click
  sau cerc, reutilizează `lib/geo.ts` — `generateCirclePolygon`,
  `distantaMetri`), tip alertă (intrare/ieșire/ambele), listă + activare/
  ștergere. Componentă nouă `components/GeofenceMapEditor.tsx`.
- `/alerte` (admin_central) — listă alerte (viteză + geofencing), filtru
  „doar necitite", marcare individuală/în masă ca citite.

**Navigare/roluri**: `lib/useUserRole.ts` extins cu `'sofer'`.
`lib/postLoginRedirect.ts`: sofer → `/curse` direct la login.
`components/LayoutShell.tsx`: meniu complet diferit pentru sofer (doar
„Cursele mele" + logout) față de admin (tot meniul + linkurile noi).

**Pași manuali rămași** (montaj fizic, nu se pot face din Claude):
1. Montare fizică FMC130 + SIM în fiecare mașină (25 buc).
2. Pentru fiecare: notează IMEI-ul, adaugă-l în Traccar (Devices → Add,
   Identifier = IMEI) — la fel ca la utilaje.
3. Adaugă mașina în aplicație din `/masini` (nume, nr. înmatriculare, IMEI,
   șofer implicit, limită viteză) — apare automat pe hartă și începe
   detectarea curselor la următorul ciclu de cron (max 5 min).
4. ~~Creează un cont cu rol Șofer pentru fiecare șofer~~ — decis
   **2026-08-31** să nu se creeze conturi de șofer (foaia de parcurs e doar
   acoperire ANAF, nu justifică overhead-ul); admin_ferma completează el
   scopul curselor din `/curse`, pentru mașinile fermei lui.
5. (Opțional) Desenează zonele de geofencing relevante din `/geofences`
   (ex. sediu, limite zonă de operare) — fără nicio zonă definită, doar
   alertele de viteză funcționează.
6. Secretele Traccar (`TRACCAR_URL`, `TRACCAR_USER`, `TRACCAR_PASSWORD`) sunt
   deja setate în Supabase (reutilizate de la modulul utilaje) — nimic nou
   de configurat acolo.

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
- `supabase/functions/get-utilaj-istoric-parcele/` — istoric ore funcționare + ore per
  parcelă, pe zile, per utilaj (folosit din `/utilaje`, admin_central only).
- `supabase/schema-*.sql` — copii sursă-de-adevăr ale migrărilor SQL aplicate în Supabase.
- `supabase/functions/sync-traccar-masini/`, `get-masini-positions/`, `get-foaie-parcurs/` — modulul flotă auto (vezi secțiunea 5, „Flotă auto").
- `components/MasiniMapView.tsx`, `components/GeofenceMapEditor.tsx`, `app/masini/`, `app/curse/`, `app/foi-parcurs/`, `app/geofences/`, `app/alerte/` — paginile modulului flotă auto.
- `app/substante/SubstanteScreen.tsx` — pagina de gestiune substanțe (nomenclator + alimentare + stoc + istoric, vezi secțiunea 5o).

## 7. Ce rămâne pentru faza 2 (neschimbat față de spec-ul inițial din CLAUDE.md)

- Tracking paleți per client (istoric, nu doar sold global).
- Modul achiziții/furnizori pentru substanțe — IMPLEMENTAT PARȚIAL 2026-09-15,
  vezi secțiunea 5o (alimentare + preț de intrare + istoric; furnizorii rămân
  câmp text liber, nu entitate separată).
- Alerte stoc minim.
- Rapoarte financiare/costuri — parțial acoperit de `dashboard/cost-productie`,
  care acum are și preț de intrare corect per substanță (secțiunea 5o).
- Fișe complete de clienți / comenzi.
- Integrare completă combustibil (Traccar + DUT-E → aplicație), condiționată de
  finalizarea testelor pe pilot.
