# Server delle licenze (Supabase)

Account con email e codice, fino a 3 dispositivi. L'app (public/js/license.js) parla con la funzione
`license`; `server/license-server.js` è la versione di riferimento usata dalle prove.

- Tabelle: `migrations/` (RLS attivo e nessuna regola: dall'esterno non si legge niente).
- Funzione: `functions/license/index.ts`.
- Segreti sul server (mai nel repository): `LICENSE_PRIVATE_JWK`, `RESEND_API_KEY`, `RESEND_FROM` (facoltativo).

Aggiornare la funzione (serve un codice di accesso in ~/.config/supabase.env):

    set -a; . ~/.config/supabase.env; set +a
    npx supabase functions deploy license --remote=<ref> --no-verify-jwt --use-api

Dare una licenza a mano (SQL editor di Supabase):

    insert into licenses (email, source) values ('cliente@esempio.it', 'manual');
