// supabase/functions/admin-delete-user/index.ts
//
// Șterge un cont (Auth + profil) apelat din ecranul /utilizatori. Doar
// admin_central poate șterge conturi.
//
// Reguli de siguranță:
//   - nu poți să-ți ștergi propriul cont (ai bloca accesul la administrare
//     din propria sesiune);
//   - nu poți șterge singurul admin_central rămas (ar bloca administrarea
//     aplicației pentru toată lumea).
//
// Ștergerea NU șterge istoricul (curse, bonuri combustibil, intrări stoc,
// operațiuni) -- doar decuplează referința către acest utilizator (o pune pe
// NULL), ca ștergerea să nu fie blocată de foreign key-uri și ca datele
// istorice să nu se piardă. jurnal_activitate păstrează oricum
// utilizator_nume/utilizator_rol ca text, separat de foreign key, deci
// rămâne lizibil în audit chiar după ștergere.
//
// 2026-09-30 (Radu): "la Meniu - Utilizatori vreau sa am posibilitatea sa
// sterg pe care vreau din ei".
//
// DEPLOYAT deja direct în Supabase (verify_jwt: true) — copie sursă de adevăr.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Tabele/coloane care referențiază utilizatori(id) și trebuie decuplate
// (SET NULL) înainte de ștergere -- toate sunt nullable, vezi
// schema-masini.sql și schema-ul de bază al aplicației.
const DECUPLARI: Array<{ tabel: string; coloana: string }> = [
  { tabel: 'masini', coloana: 'sofer_implicit_id' },
  { tabel: 'curse', coloana: 'sofer_id' },
  { tabel: 'bonuri_combustibil_masini', coloana: 'introdus_de' },
  { tabel: 'substante_intrari', coloana: 'introdus_de' },
  { tabel: 'materii_prime_intrari', coloana: 'introdus_de' },
  { tabel: 'operatiuni', coloana: 'user_id' },
  { tabel: 'jurnal_activitate', coloana: 'utilizator_id' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Lipsește autentificarea.' }, 401);
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerUser },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !callerUser) {
    return jsonResponse({ error: 'Sesiune invalidă.' }, 401);
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from('utilizatori')
    .select('rol')
    .eq('id', callerUser.id)
    .maybeSingle();

  if (profileError || callerProfile?.rol !== 'admin_central') {
    return jsonResponse({ error: 'Doar admin general poate șterge conturi.' }, 403);
  }

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corp de cerere invalid.' }, 400);
  }

  const targetId = body.id;
  if (!targetId) {
    return jsonResponse({ error: 'Lipsește id-ul contului de șters.' }, 400);
  }

  if (targetId === callerUser.id) {
    return jsonResponse({ error: 'Nu îți poți șterge propriul cont.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: target, error: targetError } = await adminClient
    .from('utilizatori')
    .select('id, nume, email, rol')
    .eq('id', targetId)
    .maybeSingle();

  if (targetError || !target) {
    return jsonResponse({ error: targetError?.message ?? 'Contul nu a fost găsit.' }, 404);
  }

  if (target.rol === 'admin_central') {
    const { count, error: countError } = await adminClient
      .from('utilizatori')
      .select('id', { count: 'exact', head: true })
      .eq('rol', 'admin_central');

    if (countError) {
      return jsonResponse(
        { error: `Eroare la verificarea numărului de admin: ${countError.message}` },
        500,
      );
    }
    if ((count ?? 0) <= 1) {
      return jsonResponse({ error: 'Nu poți șterge singurul admin general rămas.' }, 400);
    }
  }

  for (const { tabel, coloana } of DECUPLARI) {
    const { error: updateError } = await adminClient
      .from(tabel)
      .update({ [coloana]: null })
      .eq(coloana, targetId);

    if (updateError) {
      return jsonResponse(
        { error: `Eroare la decuplarea din ${tabel}.${coloana}: ${updateError.message}` },
        500,
      );
    }
  }

  const { error: deleteProfileError } = await adminClient
    .from('utilizatori')
    .delete()
    .eq('id', targetId);

  if (deleteProfileError) {
    return jsonResponse({ error: `Eroare la ștergerea profilului: ${deleteProfileError.message}` }, 500);
  }

  const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(targetId);

  if (deleteAuthError) {
    // Profilul (rolul) e deja șters -- fără el, contul nu mai are niciun
    // acces în aplicație, chiar dacă mai există tehnic în Auth. Semnalăm
    // eroarea, dar nu tratăm asta ca eșec total al operației.
    return jsonResponse({
      ok: true,
      warning: `Profilul a fost șters, dar contul de autentificare nu: ${deleteAuthError.message}`,
      nume: target.nume,
      email: target.email,
    });
  }

  return jsonResponse({ ok: true, nume: target.nume, email: target.email });
});
