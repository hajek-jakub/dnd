-- RLS testy: hráč nesmí číst ani měnit cizí postavy a DM poznámky.
-- (Soukromé zprávy přibudou s tabulkou messages ve fázi 7, test s nimi.)
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.become(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

grant execute on all functions in schema tests to anon, authenticated;

create temp table ctx (name text primary key, val text);
grant all on ctx to authenticated, anon;

-- alice = DM, bob a carol = hráči, dave = cizí
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.cz', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.cz',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@test.cz', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@test.cz',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

select tests.become('00000000-0000-0000-0000-00000000000a');
insert into ctx select 'camp', public.create_campaign('Hlavní kampaň')::text;
insert into ctx select 'camp2', public.create_campaign('Jiná kampaň')::text;
insert into ctx select 'code', (public.create_invite((select val::uuid from ctx where name = 'camp'), 7, null)).code;

select tests.become('00000000-0000-0000-0000-00000000000b');
select public.accept_invite((select val from ctx where name = 'code'));
insert into public.characters (campaign_id, owner_id, name, race, class_summary, level, notes)
  values ((select val::uuid from ctx where name = 'camp'), auth.uid(), 'Hajoš', 'Human', 'Monk 5 / Warlock 1', 6, 'TAJNÉ: bobova poznámka');
insert into ctx select 'char_bob', id::text from public.characters where owner_id = auth.uid();

select tests.become('00000000-0000-0000-0000-00000000000c');
select public.accept_invite((select val from ctx where name = 'code'));
insert into public.characters (campaign_id, owner_id, name, notes)
  values ((select val::uuid from ctx where name = 'camp'), auth.uid(), 'Carolina postava', 'carol soukromě');
insert into ctx select 'char_carol', id::text from public.characters where owner_id = auth.uid();

-- ---------------------------------------------------------------- vlastní postavy
select tests.become('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.characters), 1, 'hráč vidí v tabulce jen svou postavu');
select is((select notes from public.characters where id = (select val::uuid from ctx where name = 'char_bob')), 'TAJNÉ: bobova poznámka', 'hráč vidí své soukromé poznámky');

-- ---------------------------------------------------------------- cizí postava
select is((select count(*)::int from public.characters where id = (select val::uuid from ctx where name = 'char_carol')), 0, 'hráč nevidí cizí postavu v tabulce');
select is((select count(*)::int from public.character_public where campaign_id = (select val::uuid from ctx where name = 'camp')), 2, 'hráč vidí veřejný náhled všech postav v kampani');
select is(
  (select name from public.character_public where id = (select val::uuid from ctx where name = 'char_carol')),
  'Carolina postava', 'veřejný náhled obsahuje jméno cizí postavy');
select hasnt_column('public', 'character_public', 'notes', 'veřejný náhled neobsahuje soukromé poznámky');
select hasnt_column('public', 'character_public', 'visibility', 'veřejný náhled neprozrazuje nastavení viditelnosti');

update public.characters set name = 'Hacknuto', notes = 'hacknuto' where id = (select val::uuid from ctx where name = 'char_carol');
delete from public.characters where id = (select val::uuid from ctx where name = 'char_carol');

select tests.become('00000000-0000-0000-0000-00000000000c');
select is((select name from public.characters where id = (select val::uuid from ctx where name = 'char_carol')), 'Carolina postava', 'hráč nemůže přejmenovat ani smazat cizí postavu');
select is((select notes from public.characters where id = (select val::uuid from ctx where name = 'char_carol')), 'carol soukromě', 'hráč nemůže změnit poznámky cizí postavy');

-- Zakázané manipulace s vlastní postavou
select tests.become('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ update public.characters set visibility = 'full' where owner_id = auth.uid() $$,
  '42501', null, 'hráč si nemůže sám zveřejnit celou postavu');
select throws_ok(
  $$ update public.characters set owner_id = '00000000-0000-0000-0000-00000000000c' where owner_id = auth.uid() $$,
  '42501', null, 'hráč nemůže předat postavu jinému majiteli');
select throws_ok(
  format($$ update public.characters set campaign_id = %L where owner_id = auth.uid() $$, (select val from ctx where name = 'camp2')),
  '42501', null, 'postavu nelze přesunout do jiné kampaně');
select throws_ok(
  format($$ insert into public.characters (campaign_id, owner_id, name) values (%L, %L, 'Podvrh') $$,
    (select val from ctx where name = 'camp'), '00000000-0000-0000-0000-00000000000c'),
  '42501', null, 'hráč nemůže vytvořit postavu na cizí jméno');
select throws_ok(
  format($$ insert into public.characters (campaign_id, owner_id, name) values (%L, auth.uid(), 'Cizí kampaň') $$,
    (select val from ctx where name = 'camp2')),
  '42501', null, 'hráč nemůže vytvořit postavu v kampani, kde není členem');

-- ---------------------------------------------------------------- cizí uživatel
select tests.become('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.characters), 0, 'outsider nevidí žádné postavy');
select is((select count(*)::int from public.character_public), 0, 'outsider nevidí ani veřejný náhled');
select throws_ok(
  format($$ insert into public.characters (campaign_id, owner_id, name) values (%L, auth.uid(), 'Votrok') $$,
    (select val from ctx where name = 'camp')),
  '42501', null, 'outsider nemůže vložit postavu do cizí kampaně');

-- ---------------------------------------------------------------- DM
select tests.become('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.characters), 2, 'DM vidí všechny postavy v kampani');
update public.characters set level = 7 where id = (select val::uuid from ctx where name = 'char_bob');
select is((select level from public.characters where id = (select val::uuid from ctx where name = 'char_bob')), 7, 'DM může upravit postavu hráče');

-- DM povolí hráčům vidět celou postavu
update public.characters set visibility = 'full' where id = (select val::uuid from ctx where name = 'char_bob');
select tests.become('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.characters where id = (select val::uuid from ctx where name = 'char_bob')), 1, 'po povolení DM vidí ostatní hráči celou postavu');
update public.characters set name = 'Hacknuto' where id = (select val::uuid from ctx where name = 'char_bob');
select tests.become('00000000-0000-0000-0000-00000000000b');
select is((select name from public.characters where id = (select val::uuid from ctx where name = 'char_bob')), 'Hajoš', 'ani při plné viditelnosti nejde cizí postavu měnit');

-- ---------------------------------------------------------------- DM poznámky
select tests.become('00000000-0000-0000-0000-00000000000a');
insert into public.dm_notes (campaign_id, character_id, author_id, body)
  values ((select val::uuid from ctx where name = 'camp'), (select val::uuid from ctx where name = 'char_bob'), auth.uid(), 'Bob něco tají');
insert into ctx select 'note', id::text from public.dm_notes limit 1;
select is((select count(*)::int from public.dm_notes), 1, 'DM vidí své poznámky');

select throws_ok(
  format($$ insert into public.dm_notes (campaign_id, character_id, author_id, body) values (%L, %L, auth.uid(), 'x') $$,
    (select val from ctx where name = 'camp2'), (select val from ctx where name = 'char_bob')),
  '23503', null, 'poznámka nemůže odkazovat na postavu z jiné kampaně');

select tests.become('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.dm_notes), 0, 'hráč nevidí DM poznámky');
select throws_ok(
  format($$ insert into public.dm_notes (campaign_id, author_id, body) values (%L, auth.uid(), 'hráčská poznámka') $$,
    (select val from ctx where name = 'camp')),
  '42501', null, 'hráč nemůže vytvořit DM poznámku');
update public.dm_notes set body = 'přepsáno' where id = (select val::uuid from ctx where name = 'note');
delete from public.dm_notes where id = (select val::uuid from ctx where name = 'note');

select tests.become('00000000-0000-0000-0000-00000000000a');
select is((select body from public.dm_notes where id = (select val::uuid from ctx where name = 'note')), 'Bob něco tají', 'hráč nemůže poznámku přepsat ani smazat');

select tests.become('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.dm_notes), 0, 'outsider nevidí DM poznámky');

select * from finish();
rollback;
