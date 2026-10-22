-- Limpieza de categorías de tendencias e ideas aprobadas automáticamente.
-- Ejecutar UNA vez en el SQL Editor de Supabase. Es idempotente y no borra ideas ni guiones.
begin;

-- 1) Bandeja única "Tendencias" para lo que no encaja en ninguna temática
insert into categories (name, slug)
select 'Tendencias', 'tendencias'
where not exists (select 1 from categories where slug = 'tendencias' or name = 'Tendencias');

-- 2) Ideas de las categorías por día ("Tendencias 22 Oct"...) -> "Tendencias"; la fecha queda en ai_metadata.trend_bucket
update ideas i set
  ai_metadata = coalesce(i.ai_metadata, '{}'::jsonb)
                || jsonb_build_object('trend_bucket', coalesce(i.ai_metadata->>'trend_bucket', c.name)),
  category_id = (select id from categories where slug = 'tendencias' or name = 'Tendencias' order by name limit 1)
from categories c
where i.category_id = c.id
  and c.name ~* '^tendencias\s+\d';

-- 3) Duplicado en inglés: Technology -> Tecnología
update ideas set category_id = (select id from categories where name = 'Tecnología' limit 1)
where category_id in (select id from categories where name = 'Technology')
  and exists (select 1 from categories where name = 'Tecnología');

-- 4) Ideas de tendencias aprobadas automáticamente y SIN reel -> pendientes de aprobación (sus guiones se conservan)
update ideas i set status = 'pending_approval'
where i.status = 'approved'
  and i.ai_metadata->>'source' = 'auto_trend'
  and not exists (select 1 from scripts s join reels r on r.script_id = s.id where s.idea_id = i.id);

-- 5) Borrar las categorías por día y el duplicado, ya vacías
delete from categories c
where (c.name ~* '^tendencias\s+\d'
       or (c.name = 'Technology' and exists (select 1 from categories where name = 'Tecnología')))
  and not exists (select 1 from ideas where category_id = c.id);

commit;

-- Verificación
select c.name, count(i.id) as ideas,
       count(i.id) filter (where i.status = 'pending_approval') as pendientes,
       count(i.id) filter (where i.status = 'approved') as aprobadas
from categories c left join ideas i on i.category_id = c.id
group by c.name order by c.name;
