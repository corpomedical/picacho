-- Scarlet Apex Circuit: the two stray walls (2026-09-17).
--
-- The set check (src/lib/sets/set-check.ts) found ten things standing
-- through each other on this set, all from two objects Astra repeated one
-- copy too close:
--   · the 4 × 20 × 136 m end wall, written once at x = -52 with a second
--     copy 50 m along, so the second stands at x = -2 — through the car.
--     The far side belongs at x = +52, symmetric with the first. A repeat
--     cannot reach it (the reader clamps offsets to ±50 m), so the wall
--     loses its repeat and a mirrored copy is appended as its own object.
--   · the 104 × 16 × 8 m terminal facade at z = -64, written with a second
--     copy 50 m along, so it stands at z = -14 — through the grandstand's
--     seats and the pit lamps. The far facade at z = +64 is already its own
--     object, so this one needs no copy at all.
-- Proved on the fixture copy of this set: after these rules the check
-- returns no findings and the set has 50 objects.
--
-- Idempotent: each rule matches only the wrong offsets; run twice, the
-- second run changes nothing (the mirrored wall is appended only when the
-- wrong repeat is still there). Both the built spec and the Build editor's
-- working copy (edited_spec) are patched, where they hold these objects.
-- Every read re-normalises the spec, so nothing else needs to move.

-- 1 · Look first. Expect one row: the set, with the two objects as written.
select id, user_id, title,
       (select jsonb_agg(jsonb_build_object('i', ord - 1, 'size', o->'size', 'position', o->'position', 'repeat', o->'repeat'))
          from jsonb_array_elements(spec->'objects') with ordinality as t(o, ord)
         where o->'size' in ('[4,20,136]'::jsonb, '[104,16,8]'::jsonb)) as walls,
       jsonb_array_length(spec->'objects') as objects,
       edited_spec is not null as has_working_copy
  from location_sets
 where title = 'Scarlet Apex Circuit' and deleted_at is null;

-- 2 · The fix.
update location_sets
   set spec = jsonb_set(spec, '{objects}', (
         (select jsonb_agg(
                   case
                     when o->'size' = '[4,20,136]'::jsonb and o->'position' = '[-52,10,0]'::jsonb
                          and o->'repeat'->'offset' = '[50,0,0]'::jsonb
                       then jsonb_set(o, '{repeat}', 'null'::jsonb)
                     when o->'size' = '[104,16,8]'::jsonb and o->'repeat'->'offset' = '[0,0,50]'::jsonb
                       then jsonb_set(o, '{repeat}', 'null'::jsonb)
                     else o
                   end
                   order by ord)
            from jsonb_array_elements(spec->'objects') with ordinality as t(o, ord))
         || coalesce((select jsonb_agg(jsonb_set(jsonb_set(o, '{repeat}', 'null'::jsonb), '{position}', '[52,10,0]'::jsonb))
                        from jsonb_array_elements(spec->'objects') o
                       where o->'size' = '[4,20,136]'::jsonb and o->'position' = '[-52,10,0]'::jsonb
                         and o->'repeat'->'offset' = '[50,0,0]'::jsonb), '[]'::jsonb))),
       updated_at = now()
 where title = 'Scarlet Apex Circuit' and deleted_at is null and spec is not null
   and exists (select 1 from jsonb_array_elements(spec->'objects') o
                where (o->'size' = '[4,20,136]'::jsonb and o->'position' = '[-52,10,0]'::jsonb
                       and o->'repeat'->'offset' = '[50,0,0]'::jsonb)
                   or (o->'size' = '[104,16,8]'::jsonb and o->'repeat'->'offset' = '[0,0,50]'::jsonb));

update location_sets
   set edited_spec = jsonb_set(edited_spec, '{objects}', (
         (select jsonb_agg(
                   case
                     when o->'size' = '[4,20,136]'::jsonb and o->'position' = '[-52,10,0]'::jsonb
                          and o->'repeat'->'offset' = '[50,0,0]'::jsonb
                       then jsonb_set(o, '{repeat}', 'null'::jsonb)
                     when o->'size' = '[104,16,8]'::jsonb and o->'repeat'->'offset' = '[0,0,50]'::jsonb
                       then jsonb_set(o, '{repeat}', 'null'::jsonb)
                     else o
                   end
                   order by ord)
            from jsonb_array_elements(edited_spec->'objects') with ordinality as t(o, ord))
         || coalesce((select jsonb_agg(jsonb_set(jsonb_set(o, '{repeat}', 'null'::jsonb), '{position}', '[52,10,0]'::jsonb))
                        from jsonb_array_elements(edited_spec->'objects') o
                       where o->'size' = '[4,20,136]'::jsonb and o->'position' = '[-52,10,0]'::jsonb
                         and o->'repeat'->'offset' = '[50,0,0]'::jsonb), '[]'::jsonb))),
       updated_at = now()
 where title = 'Scarlet Apex Circuit' and deleted_at is null and edited_spec is not null
   and exists (select 1 from jsonb_array_elements(edited_spec->'objects') o
                where (o->'size' = '[4,20,136]'::jsonb and o->'position' = '[-52,10,0]'::jsonb
                       and o->'repeat'->'offset' = '[50,0,0]'::jsonb)
                   or (o->'size' = '[104,16,8]'::jsonb and o->'repeat'->'offset' = '[0,0,50]'::jsonb));

-- 3 · Look again. Expect two end walls (x = -52 and x = +52) and two facades
--     (z = -64 and z = +64), every repeat null, and one object more than before.
select title,
       (select jsonb_agg(jsonb_build_object('size', o->'size', 'position', o->'position', 'repeat', o->'repeat'))
          from jsonb_array_elements(spec->'objects') o
         where o->'size' in ('[4,20,136]'::jsonb, '[104,16,8]'::jsonb)) as walls,
       jsonb_array_length(spec->'objects') as objects
  from location_sets
 where title = 'Scarlet Apex Circuit' and deleted_at is null;
