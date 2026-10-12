-- schema-operatiuni-corectie-consum.sql
--
-- 2026-10-12 (Radu): "daca substanta se afla in bidoane de 5 litri si
-- operatorul trece ca a utilizat o unitate (deci un litru) aplicatia scade un
-- bidon, nu un litru. Din acest motiv stocurile au fost alterate si e nevoie de
-- un buton de modificare a operatiunilor, unde operatorul sa poata introduce
-- cantitatile corecte."
--
-- Până acum stocul se scădea DOAR la INSERT în `operatiuni_substante` /
-- `operatiuni_materii_prime` (triggerele scade_stoc_*). O modificare ulterioară
-- a cantității (UPDATE) nu mai atingea stocul. Aici: după un UPDATE de
-- cantitate / substanță / operațiune, stocul și prețul mediu ale substanței
-- (materiei prime) afectate se RECALCULEAZĂ cu funcțiile existente
-- `recalculeaza_stoc_substanta` / `recalculeaza_stoc_materie_prima` (stoc =
-- intrări − consumuri, în ordinea datelor) — aceleași funcții pe care le
-- folosește deja corecția alimentărilor. Verificat 2026-10-12: la toate cele
-- 66 de substanțe stoc_curent = intrări − consumuri (diferență 0), deci
-- recalcularea nu schimbă nimic înainte de prima editare.
--
-- RLS: politicile UPDATE pentru admin_central și admin_ferma (doar ferma lui)
-- existau deja pe operatiuni_substante / operatiuni_materii_prime. Fiecare
-- modificare e jurnalizată automat de triggerele `jurnal_*` (valori vechi/noi
-- + cine a făcut-o) — vizibil în /jurnal-activitate.
--
-- DDL aplicat cu `execute_sql`, câte o instrucțiune (apply_migration dă timeout).

CREATE OR REPLACE FUNCTION public.recalculeaza_stoc_dupa_editare_consum_substanta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform public.recalculeaza_stoc_substanta(old.substanta_id);
  if new.substanta_id is distinct from old.substanta_id then
    perform public.recalculeaza_stoc_substanta(new.substanta_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalculeaza_stoc_dupa_editare_consum_materie_prima()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform public.recalculeaza_stoc_materie_prima(old.materie_prima_id);
  if new.materie_prima_id is distinct from old.materie_prima_id then
    perform public.recalculeaza_stoc_materie_prima(new.materie_prima_id);
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS recalculeaza_stoc_editare_substanta_trigger ON public.operatiuni_substante;
CREATE TRIGGER recalculeaza_stoc_editare_substanta_trigger
AFTER UPDATE OF cantitate, substanta_id, operatiune_id ON public.operatiuni_substante
FOR EACH ROW
EXECUTE FUNCTION public.recalculeaza_stoc_dupa_editare_consum_substanta();

DROP TRIGGER IF EXISTS recalculeaza_stoc_editare_materie_prima_trigger ON public.operatiuni_materii_prime;
CREATE TRIGGER recalculeaza_stoc_editare_materie_prima_trigger
AFTER UPDATE OF cantitate, materie_prima_id, operatiune_id ON public.operatiuni_materii_prime
FOR EACH ROW
EXECUTE FUNCTION public.recalculeaza_stoc_dupa_editare_consum_materie_prima();
