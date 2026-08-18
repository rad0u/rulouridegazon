# Note de proiect — decizii, status, context tehnic

Acest fișier e memorie externă pentru proiect: decizii importante, ce s-a construit
deja, și de ce s-au ales anumite soluții. Scopul e ca informația să supraviețuiască
chiar dacă o conversație cu Claude se pierde sau se rezumă. Se actualizează pe măsură
ce apar decizii noi — nu e nevoie să reconstruim contextul din memorie de fiecare dată.

Ultima actualizare: 2026-08-18.

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
- Hartă interactivă per fermă: imagine încărcată de admin central, parcele desenate ca
  poligoane click-abile direct pe imagine.
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
- 36 de utilaje în total, din care **8 cu rezervor dublu** (necesită 2 sonde/utilaj) și
  28 cu un singur rezervor.
- FMC125 are un singur port RS232 **și** un singur port RS485. În mod LLS, RS232 suportă
  o singură sondă; RS485 suportă până la 5 sonde pe același cablu (bus multi-drop, fiecare
  sondă cu adresă LLS proprie — dropdown-ul „Addr” 101-108 din Service DUT-E). Deci **nu
  e nevoie de alt tracker** pentru rezervoarele duble, doar de sonde RS485 pe același bus.
- **Decizie**: pentru utilajele cu rezervor dublu se cumpără sonde **DUT-E 485** (nu 232 —
  RS232 nu suportă mai multe sonde simultan), 2 bucăți/utilaj, pe același port RS485 al
  FMC125-ului, adrese LLS diferite. Link: https://e-shop.jv-technoton.com/product/dut-e-485/
- **Listă de comandă rămasă** (pilotul, 1x FMC125 + 1x DUT-E 232, e deja acoperit):
  - 35x Teltonika FMC125 (restul utilajelor).
  - 27x DUT-E 485 — pentru utilajele cu rezervor unic, în afară de pilot.
  - 16x DUT-E 485 — pentru cele 8 utilaje cu rezervor dublu (2 buc/utilaj).
  - Total sonde de comandat: 43x DUT-E 485. SK DUT-E (kitul de configurare) deja deținut,
    reutilizabil pentru toate sondele — de luat în calcul un al doilea kit doar dacă se
    configurează sonde în paralel, în locații diferite.
- Pas rămas: pe măsură ce vine hardware-ul, se montează, se populează
  `utilaje.traccar_device_id` (IMEI) pentru fiecare, iar la utilajele cu 2 sonde se
  extinde `combustibil_citiri`/afișarea din `/utilaje` să arate ambele rezervoare separat
  (momentan schema presupune un singur nivel de combustibil per utilaj).

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
- `supabase/functions/sync-traccar-fuel/` — Edge Function pentru sincronizare combustibil
  (draft, nedeployată încă — vezi secțiunea 5).
- `supabase/schema-*.sql` — copii sursă-de-adevăr ale migrărilor SQL aplicate în Supabase.

## 7. Ce rămâne pentru faza 2 (neschimbat față de spec-ul inițial din CLAUDE.md)

- Tracking paleți per client (istoric, nu doar sold global).
- Modul achiziții/furnizori pentru substanțe.
- Alerte stoc minim.
- Rapoarte financiare/costuri.
- Fișe complete de clienți / comenzi.
- Integrare completă combustibil (Traccar + DUT-E → aplicație), condiționată de
  finalizarea testelor pe pilot.
