-- Licenze di AirDesk: account con email e codice, fino a 3 dispositivi.
-- Tutte le tabelle hanno RLS attivo e NESSUNA regola: dall'esterno non si legge né si scrive niente.
-- Solo la funzione "license" (con la chiave di servizio, che resta sul server) le usa.

create table if not exists licenses (
  email      text primary key check (email = lower(email)),
  source     text not null default 'manual',      -- manual | lemonsqueezy | paddle | appstore | play
  order_id   text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz                          -- rimborso: la licenza smette di valere
);

create table if not exists login_codes (
  email      text primary key,
  code_hash  text not null,                       -- mai il codice in chiaro
  expires_at timestamptz not null,
  tries      int not null default 0,
  sent_at    timestamptz not null default now(),
  sent_count int not null default 1               -- invii nell'ultima ora (contro l'abuso)
);

create table if not exists sessions (
  token_hash text primary key,                    -- mai la sessione in chiaro
  email      text not null,
  expires_at timestamptz not null
);
create index if not exists sessions_email on sessions (email);

create table if not exists devices (
  email      text not null,
  id         text not null check (id ~ '^[0-9a-f-]{16,64}$'),
  name       text not null default '',
  platform   text not null default '',
  since      timestamptz not null default now(),
  primary key (email, id)
);

alter table licenses    enable row level security;
alter table login_codes enable row level security;
alter table sessions    enable row level security;
alter table devices     enable row level security;
revoke all on licenses, login_codes, sessions, devices from anon, authenticated;

-- Attiva un dispositivo rispettando il limite anche con richieste in contemporanea.
-- Restituisce 'ok', 'no-license' o 'limit'.
create or replace function activate_device(p_email text, p_id text, p_name text, p_platform text, p_max int default 3)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_email));
  if not exists (select 1 from licenses where email = p_email and revoked_at is null) then
    return 'no-license';
  end if;
  if not exists (select 1 from devices where email = p_email and id = p_id)
     and (select count(*) from devices where email = p_email) >= p_max then
    return 'limit';
  end if;
  insert into devices (email, id, name, platform) values (p_email, p_id, left(p_name, 40), left(p_platform, 10))
  on conflict (email, id) do update set name = excluded.name, platform = excluded.platform;
  return 'ok';
end $$;
revoke all on function activate_device from public, anon, authenticated;
