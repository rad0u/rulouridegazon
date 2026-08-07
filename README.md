# Rulouri de Gazon App

Aplicație Next.js + Supabase pentru digitalizarea managementului de ferme și parcele.

## Pași inițiali

1. Instalează dependențele:
   ```bash
   npm install
   ```
2. Configurează `.env.local` cu:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
3. Rulează aplicația:
   ```bash
   npm run dev
   ```

## Structură

- `app/` - rute Next.js
- `components/` - componente UI reutilizabile
- `lib/` - client Supabase și helper-e
- `supabase/` - SQL pentru politici RLS și seed inițial

## RLS

Fișierul `supabase/policies.sql` conține politici pentru:
- `admin_central` vede tot
- `admin_ferma` vede/scrie doar în cadrul fermei sale

## Note

- Trebuie să sincronizezi rolul utilizatorului în tabela `utilizatori`.
- Dacă folosești autentificare Supabase, asigură-te că `utilizatori.id` corespunde cu `auth.uid()`.
