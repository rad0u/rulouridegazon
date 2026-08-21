# Ghid de teren — configurare FMC125 + DUT-E (de atașat la o conversație nouă)

Context pentru Claude: SC Rulouri de Gazon SRL, 5 ferme de gazon. Se montează Teltonika
FMC125 (GPS/GPRS) + senzor de combustibil Technoton DUT-E pe 36 de utilaje agricole.
Pilotul (Săbăreni, DUT-E 232, IMEI 862272083141426) e deja montat și funcțional, trimite
date live în Traccar și în aplicația proprie (rulouridegazon.vercel.app → /utilaje,
/combustibil). Azi se montează și configurează al doilea set, la garaj.

## Hardware / decizii cheie

- **36 utilaje**, din care 8 cu rezervor dublu (interconectate, un singur punct de
  umplere). Decizie: **1 sondă/utilaj chiar și la cele cu rezervor dublu** (rezervoarele
  comunicante se echilibrează, nivelul dintr-un singur punct reflectă sistemul). De
  revizuit doar dacă apar anomalii de citire pe cele cu rezervor dublu.
- **Senzor standard pentru instalările noi: DUT-E 485** (nu 232 — pilotul rămâne pe 232,
  deja montat). Fără diferență de preț, RS485 mai rezistent la interferențe.
- FMC125 are ambele porturi, RS232 (pini 3/4) și RS485 (pini 9/10) — pinout complet 2x6:
  1=VCC(+10-30V), 2=AIN1/DIN2, 3=RS232-RX, 4=RS232-TX, 5=DIN1(ignition), 6=INPUT6, 7=GND(-),
  8=DOUT1, 9=RS485-A, 10=RS485-B, 11=1-Wire, 12=INPUT5.
- Conexiune GND comună (o singură masă din caroserie, pe bulon curat, vopsea răzuită) —
  bună practică pentru RS232 (semnal single-ended).

## Software + drivere (Windows)

- **FMC125 — Teltonika Configurator**: listă versiuni (alege după firmware) —
  https://wiki.teltonika-gps.com/view/Teltonika_Configurator_versions
- **FMC125 — driver COM port**: https://wiki.teltonika-gps.com/images/d/d0/TeltonikaCOMDriver.zip
- **DUT-E — ServiceS6 DUT-E v6.12** (cel folosit deja): https://jv-technoton.com/data/ServiceS6_DUT-E.zip
- **DUT-E — driver interfață USB (CP210x)**: https://jv-technoton.com/data/CP210x_Windows_Drivers.zip
- Login ServiceS6 DUT-E: user „0", parolă implicită **1111**.

## Configurare DUT-E (ServiceS6 DUT-E v6.12)

Meniu stânga → **Fuel Level Sensor** (nu „Fuel Level Control"), 4 taburi sus:
- **Calibration** — min/max senzor (Empty/Full), NU e nevoie decât dacă se taie proba.
- **Calibration Table** — tabelul Level(mm)/Volume(L), cel important. Se completează cu
  date reale culese la umplerea rezervorului. Recomandat minim 15 puncte, maxim 30.
- **Settings** — „Filtering interval" (implicit 60s, de urcat la 90-120s pe teren
  accidentat, reduce zgomotul de sloshing), coeficient corecție termică, lungime probă
  după tăiere.
- **Parameters** — valori live curente (verificare).

Procedura de calibrare tabel (per utilaj):
1. Golește complet rezervorul.
2. Montează sonda (la pilot: ~2cm de fund, pe arc).
3. Umple în porții măsurate exact (pompă cu contor, nu găleată aproximativă), de la gol
   la plin. Mărimea porției = capacitate totală estimată / ~15-20 (evită sute de porții
   mici, dar și prea puține puncte).
4. După fiecare porție așteaptă ~60s să se stabilizeze citirea, apoi scrie în tabel:
   Level = ce arată senzorul acum, Volume = **litri cumulați până acum** (nu incrementul).
5. Primele porții pot să nu miște deloc citirea (rezervorul se umple mai întâi sub vârful
   sondei) — normal, continuă să notezi.
6. La final: **Settings → Output message / Output Parameter Type Measure** → schimbă pe
   litri (L), nu mm.
7. **Save → to sensor** (cere parola de specialist dacă nu ești deja logat).

## Configurare FMC125 (Teltonika Configurator)

- RS232 sau RS485 → mod **LLS** (fuel sensor), baudrate 19200.
- I/O: „LLS 1 Fuel Level" — Operand **Monitoring** (nu On Exit/Entrance), Priority Low,
  ca valoarea să apară în fiecare înregistrare periodică fără trafic suplimentar.
- Confirmat în Traccar: atributul de combustibil e **io201**.
- După configurare: **Reboot device** din Configurator, ca să forțezi o înregistrare nouă
  imediat (altfel poate dura ~1h dacă utilajul stă pe loc cu contactul oprit).
- Adaugă utilajul în Traccar (Devices → Add, Identifier = IMEI) și în tabela `utilaje`
  din Supabase (`traccar_device_id` = IMEI), ca să apară în aplicație.

## Pentru integrare în aplicație (după montaj)

Trimite-mi: numele utilajului, ferma, IMEI-ul FMC125, și — după calibrare — capacitatea
reală a rezervorului (litri). Le adaug în baza de date și apar automat în /utilaje și
/combustibil.
