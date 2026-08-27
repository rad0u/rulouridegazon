// supabase/functions/admin-create-user/index.ts
//
// Creează un cont nou (Auth + rol) apelat din ecranul /utilizatori al
// aplicației. Doar admin_central poate crea conturi. Odată creat contul prin
// Auth Admin API cu user_metadata { rol, ferma_id }, trigger-ul existent
// (sync_utilizatori_from_auth) populează automat public.utilizatori.

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

  // Client cu identitatea apelantului, ca să-i verificăm rolul.
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
    return jsonResponse({ error: 'Doar admin general poate crea conturi.' }, 403);
  }

  let body: {
    email?: string;
    parola?: string;
    nume?: string;
    rol?: string;
    ferma_id?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corp de cerere invalid.' }, 400);
  }

  const email = body.email?.trim();
  const parola = body.parola;
  const nume = body.nume?.trim() || undefined;
  const rol = body.rol;
  const fermaId = body.rol === 'admin_ferma' ? body.ferma_id || null : null;

  if (!email || !parola) {
    return jsonResponse({ error: 'Email și parolă sunt obligatorii.' }, 400);
  }

  if (parola.length < 6) {
    return jsonResponse({ error: 'Parola trebuie să aibă minim 6 caractere.' }, 400);
  }

  if (rol !== 'admin_central' && rol !== 'admin_ferma' && rol !== 'sofer') {
    return jsonResponse({ error: 'Rol invalid.' }, 400);
  }

  if (rol === 'admin_ferma' && !fermaId) {
    return jsonResponse({ error: 'Alege ferma pentru admin de fermă.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: parola,
    email_confirm: true,
    user_metadata: {
      rol,
      ferma_id: fermaId,
      full_name: nume,
    },
  });

  if (createError || !created.user) {
    return jsonResponse({ error: createError?.message ?? 'Eroare la crearea contului.' }, 400);
  }

  return jsonResponse({ id: created.user.id, email: created.user.email });
});
