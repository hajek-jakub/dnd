-- Fáze 1: jádro – profily, kampaně, členství (role per kampaň), pozvánky,
-- minimální postavy s veřejným náhledem a soukromé DM poznámky.
--
-- Bezpečnostní model:
--  * RLS je zapnuté na všech tabulkách, výchozí stav je "zakázáno".
--  * Role anon nemá k datům žádný přístup.
--  * Zápisy, které by klient nesměl dělat přímo (založení kampaně, pozvánky,
--    přijetí pozvánky), jdou jen přes funkce se SECURITY DEFINER.
--  * Pomocné funkce pro RLS jsou SECURITY DEFINER, aby se politiky nezacyklily.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Typy
-- ---------------------------------------------------------------------------
create type public.campaign_role as enum ('dm', 'player');
create type public.character_visibility as enum ('public_only', 'full');

-- ---------------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  -- Nastavení kampaně (např. {"encumbrance": false}); pravidla se doplní v dalších fázích.
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.campaign_role not null,
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
-- FK na profiles umožní PostgREST embed (campaign_members -> profiles).
alter table public.campaign_members
  add constraint campaign_members_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;
create index campaign_members_user_idx on public.campaign_members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  revoked boolean not null default false
);
create index invites_campaign_idx on public.invites (campaign_id);

-- Minimální postava; plný character sheet přijde ve fázi 3.
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  race text not null default '',
  class_summary text not null default '',
  level integer not null default 1 check (level between 1 and 20),
  photo_path text,
  -- Soukromá část (ostatní hráči ji nevidí, pokud DM nepovolí 'full').
  notes text not null default '',
  visibility public.character_visibility not null default 'public_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.characters add constraint characters_id_campaign_key unique (id, campaign_id);
create index characters_campaign_idx on public.characters (campaign_id);
create index characters_owner_idx on public.characters (owner_id);

create table public.dm_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  character_id uuid,
  author_id uuid not null references auth.users (id),
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Poznámka k postavě musí patřit do stejné kampaně jako postava.
  foreign key (character_id, campaign_id)
    references public.characters (id, campaign_id) on delete cascade
);
create index dm_notes_campaign_idx on public.dm_notes (campaign_id);

-- ---------------------------------------------------------------------------
-- Pomocné funkce pro RLS (SECURITY DEFINER, prázdný search_path)
-- ---------------------------------------------------------------------------
create function public.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id and m.user_id = auth.uid()
  );
$$;

create function public.is_campaign_dm(p_campaign_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id and m.user_id = auth.uid() and m.role = 'dm'
  );
$$;

create function public.is_user_in_campaign(p_campaign_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id and m.user_id = p_user_id
  );
$$;

create function public.shares_campaign_with(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.campaign_members me
    join public.campaign_members other on other.campaign_id = me.campaign_id
    where me.user_id = auth.uid() and other.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggery
-- ---------------------------------------------------------------------------
-- Profil se vytvoří automaticky při registraci.
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Hráč'), 60)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Hlídá změny citlivých sloupců postavy (platí i pro přímé API volání).
create function public.characters_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.campaign_id <> old.campaign_id then
    raise exception 'Postavu nelze přesunout do jiné kampaně' using errcode = '42501';
  end if;
  if not public.is_campaign_dm(old.campaign_id) then
    if new.owner_id <> old.owner_id then
      raise exception 'Majitele postavy může změnit jen DM' using errcode = '42501';
    end if;
    if new.visibility <> old.visibility then
      raise exception 'Viditelnost postavy může změnit jen DM' using errcode = '42501';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger characters_guard_trg
before update on public.characters
for each row execute function public.characters_guard();

create trigger dm_notes_touch
before update on public.dm_notes
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Veřejný náhled postav (jen jméno, fotka, rasa, třída, level)
-- View běží s právy vlastníka (obchází RLS), proto filtruje sama: jen členové kampaně.
-- ---------------------------------------------------------------------------
create view public.character_public
with (security_invoker = false)
as
select c.id, c.campaign_id, c.owner_id, c.name, c.photo_path, c.race, c.class_summary, c.level
from public.characters c
where public.is_campaign_member(c.campaign_id);

-- ---------------------------------------------------------------------------
-- RPC funkce
-- ---------------------------------------------------------------------------
create function public.create_campaign(p_name text, p_description text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Nepřihlášený uživatel' using errcode = '28000';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Název kampaně je povinný' using errcode = '22023';
  end if;

  insert into public.campaigns (name, description, created_by)
  values (btrim(p_name), coalesce(p_description, ''), v_uid)
  returning id into v_id;

  insert into public.campaign_members (campaign_id, user_id, role)
  values (v_id, v_uid, 'dm');

  return v_id;
end;
$$;

-- Kód pozvánky: 10 znaků bez zaměnitelných (0/O, 1/I/L).
create function public.generate_invite_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_code text := '';
  i int;
begin
  for i in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % char_length(v_alphabet)) + 1, 1);
  end loop;
  return v_code;
end;
$$;

create function public.create_invite(
  p_campaign_id uuid,
  p_expires_in_days integer default 7,
  p_max_uses integer default null
)
returns public.invites
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.invites;
begin
  if not public.is_campaign_dm(p_campaign_id) then
    raise exception 'Pozvánky může vytvářet jen DM' using errcode = '42501';
  end if;
  if p_expires_in_days is not null and p_expires_in_days not between 1 and 365 then
    raise exception 'Platnost pozvánky musí být 1 až 365 dní' using errcode = '22023';
  end if;

  insert into public.invites (campaign_id, code, created_by, expires_at, max_uses)
  values (
    p_campaign_id,
    public.generate_invite_code(),
    auth.uid(),
    case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end,
    p_max_uses
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Náhled pozvánky před přijetím (název kampaně a DM), jen pro přihlášené.
create function public.preview_invite(p_code text)
returns table (campaign_id uuid, campaign_name text, dm_name text, already_member boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášený uživatel' using errcode = '28000';
  end if;

  return query
  select c.id,
         c.name,
         coalesce((
           select p.display_name
           from public.campaign_members m
           join public.profiles p on p.id = m.user_id
           where m.campaign_id = c.id and m.role = 'dm'
           order by m.joined_at
           limit 1
         ), ''),
         exists (
           select 1 from public.campaign_members m
           where m.campaign_id = c.id and m.user_id = auth.uid()
         )
  from public.invites i
  join public.campaigns c on c.id = i.campaign_id
  where i.code = upper(btrim(p_code))
    and not i.revoked
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses);

  if not found then
    raise exception 'Pozvánka je neplatná, vypršela nebo byla zrušena' using errcode = 'P0002';
  end if;
end;
$$;

create function public.accept_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.invites;
begin
  if v_uid is null then
    raise exception 'Nepřihlášený uživatel' using errcode = '28000';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(btrim(p_code))
  for update;

  if not found
     or v_invite.revoked
     or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses) then
    raise exception 'Pozvánka je neplatná, vypršela nebo byla zrušena' using errcode = 'P0002';
  end if;

  -- Už je členem (třeba jako DM): nic se nemění, pozvánka se nespotřebuje.
  if exists (
    select 1 from public.campaign_members
    where campaign_id = v_invite.campaign_id and user_id = v_uid
  ) then
    return v_invite.campaign_id;
  end if;

  insert into public.campaign_members (campaign_id, user_id, role)
  values (v_invite.campaign_id, v_uid, 'player');

  update public.invites set uses = uses + 1 where id = v_invite.id;

  return v_invite.campaign_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Oprávnění: anon nic, authenticated jen přes RLS a vybrané funkce
-- ---------------------------------------------------------------------------
-- Supabase ve výchozím stavu dává rolím anon/authenticated plná práva na vše v public.
-- Nejdřív je odebereme a pak přidělíme jen to, co je potřeba (RLS je druhá vrstva obrany).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Totéž pro objekty vytvořené v budoucích migracích: každá migrace musí práva přidělit výslovně.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update, delete on public.campaigns to authenticated;
grant select, delete on public.campaign_members to authenticated;
grant select, update, delete on public.invites to authenticated;
grant select, insert, update, delete on public.characters to authenticated;
grant select, insert, update, delete on public.dm_notes to authenticated;
grant select on public.character_public to authenticated;

grant execute on function public.is_campaign_member(uuid) to authenticated;
grant execute on function public.is_campaign_dm(uuid) to authenticated;
grant execute on function public.shares_campaign_with(uuid) to authenticated;
grant execute on function public.is_user_in_campaign(uuid, uuid) to authenticated;
grant execute on function public.create_campaign(text, text) to authenticated;
grant execute on function public.create_invite(uuid, integer, integer) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.invites enable row level security;
alter table public.characters enable row level security;
alter table public.dm_notes enable row level security;

-- profiles: vidím sebe a spoluhráče z kampaní, upravuji jen sebe
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_campaign_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- campaigns: vidí členové, mění a maže DM, zakládá se přes create_campaign()
create policy campaigns_select on public.campaigns for select to authenticated
  using (public.is_campaign_member(id));
create policy campaigns_update on public.campaigns for update to authenticated
  using (public.is_campaign_dm(id)) with check (public.is_campaign_dm(id));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (public.is_campaign_dm(id));

-- campaign_members: vidí členové kampaně; odejít smí hráč sám, DM smí odebrat hráče.
-- Přidávání jde jen přes accept_invite()/create_campaign(), role se klientem měnit nedá.
create policy members_select on public.campaign_members for select to authenticated
  using (public.is_campaign_member(campaign_id));
create policy members_delete on public.campaign_members for delete to authenticated
  using (
    role = 'player'
    and (user_id = auth.uid() or public.is_campaign_dm(campaign_id))
  );

-- invites: výhradně DM kampaně
create policy invites_select on public.invites for select to authenticated
  using (public.is_campaign_dm(campaign_id));
create policy invites_update on public.invites for update to authenticated
  using (public.is_campaign_dm(campaign_id)) with check (public.is_campaign_dm(campaign_id));
create policy invites_delete on public.invites for delete to authenticated
  using (public.is_campaign_dm(campaign_id));

-- characters: plný přístup má majitel a DM; ostatní jen přes character_public
-- (nebo celé řádky, pokud DM nastaví visibility = 'full').
create policy characters_select on public.characters for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_campaign_dm(campaign_id)
    or (visibility = 'full' and public.is_campaign_member(campaign_id))
  );
create policy characters_insert on public.characters for insert to authenticated
  with check (
    (public.is_campaign_dm(campaign_id) and public.is_user_in_campaign(campaign_id, owner_id))
    or (owner_id = auth.uid() and public.is_campaign_member(campaign_id))
  );
create policy characters_update on public.characters for update to authenticated
  using (owner_id = auth.uid() or public.is_campaign_dm(campaign_id))
  with check (
    public.is_user_in_campaign(campaign_id, owner_id)
    and (owner_id = auth.uid() or public.is_campaign_dm(campaign_id))
  );
create policy characters_delete on public.characters for delete to authenticated
  using (owner_id = auth.uid() or public.is_campaign_dm(campaign_id));

-- dm_notes: nikdy nikdo kromě DM
create policy dm_notes_all on public.dm_notes for all to authenticated
  using (public.is_campaign_dm(campaign_id))
  with check (public.is_campaign_dm(campaign_id) and author_id = auth.uid());
