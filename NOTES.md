# Note de proiect — decizii, status, context tehnic

Acest fișier e memorie externă pentru proiect: decizii importante, ce s-a construit
deja, și de ce s-au ales anumite soluții. Scopul e ca informația să supraviețuiască
chiar dacă o conversație cu Claude se pierde sau se rezumă. Se actualizează pe măsură
ce apar decizii noi — nu e nevoie să reconstruim contextul din memorie de fiecare dată.

Ultima actualizare: 2026-08-12.

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

### Pilot monitorizare combustibil (utilaje agricole)
- **Tracker GPS**: Teltonika FMC125 (LTE, dual-SIM, RS232, fuel monitoring, acumulator
  back-up inclus în cutie).
- **Senzor combustibil**: Technoton DUT-E 232 (senzor digital RS232, capacitiv, 1%
  precizie). Link produs: https://e-shop.jv-technoton.com/product/dut-e-232/
- **Interfață configurare senzor**: SK DUT-E (nu S6 SK — acela e pentru altă linie de
  produse, cu conector SC). Link: https://e-shop.jv-technoton.com/product/sk-dut-e/
- Status: echipamentul pilot a fost comandat, urmează testare pe birou înainte de montaj
  pe utilaj, apoi configurare SIM de date și integrare cu Traccar.
- Server Traccar (self-hosted): http://135.181.45.175/. Dispozitivele se identifică în
  Traccar după IMEI (câmpul „Identifier").
- Pas rămas pentru integrare în aplicație: după ce datele curg real în Traccar, se
  confirmă numele exact al atributului de combustibil raportat și se finalizează/
  deployează `supabase/functions/sync-traccar-fuel/index.ts` (momentan draft, cu TODO-uri).
  Se populează și `utilaje.traccar_device_id` cu IMEI-urile reale.

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
