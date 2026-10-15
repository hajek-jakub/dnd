-- RLS testy: kampaně, členství, role per kampaň, pozvánky.
-- Spuštění: npm run test:db   (supabase test db)
begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- Pomocné funkce pro přepínání uživatele (existují jen uvnitř této transakce).
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.become(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.become_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

grant execute on all functions in schema tests to anon, authenticated;

create temp table ctx (name text primary key, val text);
grant all on ctx to authenticated, anon;

-- Uživatelé: alice (DM kampaně A), bob a carol (hráči), dave (cizí)
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.cz', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.cz',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@test.cz', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@test.cz',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

select is((select count(*)::int from public.profiles where id::text like '00000000-0000-0000-0000-00000000000_'), 4, 'profil se vytvoří automaticky pro každého uživatele');

-- ---------------------------------------------------------------- Alice zakládá kampaň
select tests.become('00000000-0000-0000-0000-00000000000a');

insert into ctx select 'camp_a', public.create_campaign('Kampaň A', 'popis')::text;

select is(
  (select role::text from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_a') and user_id = auth.uid()),
  'dm', 'zakladatel kampaně je DM');

select is((select count(*)::int from public.campaigns), 1, 'DM vidí svou kampaň');

-- Alice jako hráč v kampani B, kterou založil Bob (role per kampaň)
select tests.become('00000000-0000-0000-0000-00000000000b');
insert into ctx select 'camp_b', public.create_campaign('Kampaň B')::text;

select tests.become('00000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------- Pozvánky
select tests.become('00000000-0000-0000-0000-00000000000a');
insert into ctx select 'code_a', (public.create_invite((select val::uuid from ctx where name = 'camp_a'), 7, null)).code;

select matches((select val from ctx where name = 'code_a'), '^[A-HJKMNP-Z2-9]{10}$', 'kód pozvánky má 10 jednoznačných znaků');

select is((select count(*)::int from public.invites), 1, 'DM vidí pozvánky své kampaně');

-- Cizí (dave) nesmí nic z kampaně A vidět ani dělat
select tests.become('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.campaigns), 0, 'outsider nevidí cizí kampaně');
select is((select count(*)::int from public.campaign_members), 0, 'outsider nevidí členy cizích kampaní');
select is((select count(*)::int from public.invites), 0, 'outsider nevidí pozvánky');
select throws_ok(
  format('select public.create_invite(%L, 7, null)', (select val from ctx where name = 'camp_a')),
  '42501', null, 'outsider nemůže vytvořit pozvánku');
select throws_ok(
  $$ insert into public.campaign_members (campaign_id, user_id, role) values ((select val::uuid from ctx where name = 'camp_a'), '00000000-0000-0000-0000-00000000000d', 'dm') $$,
  '42501', null, 'outsider se nemůže přímým insertem udělat DM');
select throws_ok(
  $$ insert into public.campaigns (name, created_by) values ('Hack', '00000000-0000-0000-0000-00000000000d') $$,
  '42501', null, 'kampaň nelze založit přímým insertem (jen přes RPC)');
select throws_ok(
  $$ select public.accept_invite('NEEXISTUJE') $$,
  'P0002', null, 'neexistující kód pozvánky se odmítne');

-- Bob přijímá pozvánku do kampaně A
select tests.become('00000000-0000-0000-0000-00000000000b');
select is(
  (select campaign_name from public.preview_invite((select val from ctx where name = 'code_a'))),
  'Kampaň A', 'náhled pozvánky ukáže název kampaně');
select is(
  public.accept_invite((select val from ctx where name = 'code_a')),
  (select val::uuid from ctx where name = 'camp_a'), 'přijetí pozvánky vrátí id kampaně');
select is(
  (select role::text from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_a') and user_id = auth.uid()),
  'player', 'pozvaný je hráč');
select is(
  (select role::text from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_b') and user_id = auth.uid()),
  'dm', 'tentýž uživatel je v jiné kampani DM (role per kampaň)');

-- Opakované přijetí nespotřebuje pozvánku znovu
select public.accept_invite((select val from ctx where name = 'code_a'));
select tests.become('00000000-0000-0000-0000-00000000000a');
select is((select uses from public.invites where code = (select val from ctx where name = 'code_a')), 1, 'opakované přijetí nezvyšuje počet použití');

-- Hráč bob v kampani A
select tests.become('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_a')), 2, 'hráč vidí členy své kampaně');
select is((select count(*)::int from public.invites), 0, 'hráč nevidí pozvánky');
select throws_ok(
  format('select public.create_invite(%L, 7, null)', (select val from ctx where name = 'camp_a')),
  '42501', null, 'hráč nemůže vytvářet pozvánky');

update public.campaigns set name = 'Přejmenováno hráčem' where id = (select val::uuid from ctx where name = 'camp_a');
select throws_ok(
  $$ update public.campaign_members set role = 'dm' where user_id = auth.uid() $$,
  '42501', null, 'hráč nemá právo měnit role členů');
delete from public.campaigns where id = (select val::uuid from ctx where name = 'camp_a');

select tests.become('00000000-0000-0000-0000-00000000000a');
select is((select name from public.campaigns where id = (select val::uuid from ctx where name = 'camp_a')), 'Kampaň A', 'hráč nepřejmenuje ani nesmaže kampaň');
select is(
  (select role::text from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_a') and user_id = '00000000-0000-0000-0000-00000000000b'),
  'player', 'role hráče zůstala beze změny');

-- Hráč nesmí odebrat DM
select tests.become('00000000-0000-0000-0000-00000000000b');
delete from public.campaign_members
  where campaign_id = (select val::uuid from ctx where name = 'camp_a') and role = 'dm';
select tests.become('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_a') and role = 'dm'), 1, 'hráč nemůže odebrat DM');

-- Profily: spoluhráč ano, cizí ne
select tests.become('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 1, 'hráč vidí profil DM své kampaně');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000000d'), 0, 'hráč nevidí profil cizího uživatele');
update public.profiles set display_name = 'Podvrh' where id = '00000000-0000-0000-0000-00000000000a';
select tests.become('00000000-0000-0000-0000-00000000000a');
select isnt((select display_name from public.profiles where id = auth.uid()), 'Podvrh', 'cizí profil nelze upravit');

-- Neplatné pozvánky: zrušená, vypršelá, vyčerpaná
select tests.become('00000000-0000-0000-0000-00000000000a');
insert into ctx select 'code_revoked', (public.create_invite((select val::uuid from ctx where name = 'camp_a'), 7, null)).code;
update public.invites set revoked = true where code = (select val from ctx where name = 'code_revoked');
insert into ctx select 'code_full', (public.create_invite((select val::uuid from ctx where name = 'camp_a'), 7, 1)).code;
update public.invites set uses = 1 where code = (select val from ctx where name = 'code_full');
insert into ctx select 'code_old', (public.create_invite((select val::uuid from ctx where name = 'camp_a'), 1, null)).code;
reset role;
update public.invites set expires_at = now() - interval '1 hour' where code = (select val from ctx where name = 'code_old');

select tests.become('00000000-0000-0000-0000-00000000000c');
select throws_ok(format('select public.accept_invite(%L)', (select val from ctx where name = 'code_revoked')), 'P0002', null, 'zrušená pozvánka nejde použít');
select throws_ok(format('select public.accept_invite(%L)', (select val from ctx where name = 'code_full')), 'P0002', null, 'vyčerpaná pozvánka nejde použít');
select throws_ok(format('select public.accept_invite(%L)', (select val from ctx where name = 'code_old')), 'P0002', null, 'vypršelá pozvánka nejde použít');

-- Hráč může z kampaně odejít, DM ne (kampaň by osiřela)
select tests.become('00000000-0000-0000-0000-00000000000b');
delete from public.campaign_members
  where campaign_id = (select val::uuid from ctx where name = 'camp_a') and user_id = auth.uid();
select is((select count(*)::int from public.campaigns where id = (select val::uuid from ctx where name = 'camp_a')), 0, 'hráč po odchodu kampaň nevidí');

select tests.become('00000000-0000-0000-0000-00000000000a');
delete from public.campaign_members
  where campaign_id = (select val::uuid from ctx where name = 'camp_a') and user_id = auth.uid();
select is((select count(*)::int from public.campaign_members where campaign_id = (select val::uuid from ctx where name = 'camp_a') and role = 'dm'), 1, 'DM se nemůže odebrat z vlastní kampaně');

-- Anonymní uživatel nemá k ničemu přístup
select tests.become_anon();
select throws_ok($$ select count(*) from public.campaigns $$, '42501', null, 'anon nemá přístup k tabulce campaigns');
select throws_ok($$ select public.create_campaign('Anon') $$, '42501', null, 'anon nemůže volat create_campaign');

select * from finish();
rollback;
