# Amortizare investiție — sistem GPS + monitorizare combustibil

## Datele de bază

| | |
|---|---|
| Investiție (36 utilaje, GPS + senzor combustibil) | 7.200 EUR |
| Consum lunar de motorină (flotă) | 2.500 L |
| Preț motorină (referință retail) | ~1,95 EUR/L (10,2 lei/L ÷ 5,24 lei/EUR, curs BNR 19.08.2026) |
| Valoare lunară a consumului total | ~4.875 EUR |

Notă: dacă flota folosește motorină agricolă (cu accize reduse), prețul real per litru
e mai mic decât cel de referință de mai sus — ceea ce înseamnă că estimările de mai jos
sunt, dacă ceva, **conservatoare** (varianta bună a poveștii, nu cea optimistă).

## Cât se pierde azi, fără monitorizare?

Nu avem cifra exactă pentru flota noastră — de asta se face pilotul. Dar surse din
industria de fleet management (NAFA, rapoarte de fuel monitoring) arată constant că
flotele **nemonitorizate** pierd, prin furt, consum nejustificat sau raportare greșită,
undeva între **5% și 15% din bugetul de combustibil pe an**.

## Amortizare, în funcție de cât se pierde real

| Pierdere presupusă | Litri pierduți/lună | Valoare pierdută/lună | Timp de amortizare investiție |
|---|---|---|---|
| 5% (limita joasă din industrie) | 125 L | ~244 EUR | ~30 luni (2,5 ani) |
| 8% | 200 L | ~390 EUR | ~18,5 luni (1,5 ani) |
| 10% (medie tipică) | 250 L | ~488 EUR | ~15 luni (1,2 ani) |
| 15% (limita înaltă din industrie) | 375 L | ~731 EUR | ~10 luni (0,8 ani) |

## Concluzie

Chiar și în scenariul cel mai puțin favorabil pentru investiție — pierderi de doar 5%,
la limita joasă a ce raportează industria — sistemul se amortizează **doar din
combustibilul economisit**, în sub 2,5 ani. Dacă pierderile reale sunt aproape de media
tipică (8-10%), amortizarea e sub un an și jumătate.

La asta se adaugă, fără cost suplimentar, beneficii care nu sunt cuantificate mai sus:
poziția GPS a fiecărui utilaj în timp real, istoric de traseu, ore reale de funcționare
pentru mentenanță programată și o bază de date solidă pentru negocieri viitoare cu
furnizorii de combustibil.

Mai mult, datele de combustibil se integrează direct în aplicația de digitalizare a
fermelor pe care o dezvoltăm în paralel — unde suprafețele fiecărei parcele sunt deja
măsurate exact, iar orele de lucru, substanțele și consumurile sunt înregistrate pe
operațiune. Combustibilul e ultima piesă lipsă din acest tablou: odată integrat, putem
calcula un cost de producție per metru pătrat, per parcelă și per fermă mult mai exact
decât estimările actuale — o plusvaloare care depășește simpla economie la combustibil
și susține decizii mai bune de preț și alocare a resurselor pe termen lung.

Pilotul de la Săbăreni (deja funcțional) ne va da în câteva săptămâni prima cifră reală
de consum vs. estimări — moment în care putem înlocui presupunerile din tabelul de mai
sus cu date proprii.

---
*Sources: [NAFA — Fuel Theft Statistics](https://worldmetrics.org/fuel-theft-statistics/), [curs BNR 19.08.2026 — money.ro](https://www.money.ro/stiri/curs-bnr-2026-08-18), [preț carburanți 18.08.2026 — RomaniaTV](https://www.romaniatv.net/pret-carburanti-18-august-2026-motorina-se-mentine-peste-10-lei_9756067.html)*
