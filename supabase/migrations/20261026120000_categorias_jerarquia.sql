-- Categorías con jerarquía: 6 principales temáticas con subcategorías + "Tendencias", que agrupa lo que es
-- tendencia pero no encaja en ninguna (nada se pierde). La IA solo elige entre estas; ya no crea categorías nuevas.
alter table public.categories add column if not exists parent_id uuid references public.categories(id) on delete set null;
alter table public.categories add column if not exists sort_order int not null default 0;

-- Renombrar las existentes que pasan a la nueva estructura
update public.categories set name = 'Entretenimiento', slug = 'entretenimiento'
  where slug = 'cultura-pop' and not exists (select 1 from public.categories where slug = 'entretenimiento');
update public.categories set name = 'Fútbol' where slug = 'futbol';
update public.categories set name = 'Nutrición' where slug = 'nutricion';
update public.categories set name = 'Gadgets y Hardware' where slug = 'hardware';

-- Principales
insert into public.categories (name, slug) values
  ('Ecuador', 'ecuador'), ('Mundo', 'mundo'), ('Deportes', 'deportes'),
  ('Tecnología', 'tecnologia'), ('Entretenimiento', 'entretenimiento'), ('Ciencia y Salud', 'ciencia-y-salud'),
  ('Tendencias', 'tendencias')
on conflict do nothing;

-- Subcategorías (nombre, slug, principal, orden)
drop table if exists _subs;
create temp table _subs (name text, slug text, parent_slug text, ord int);
insert into _subs values
  ('Política', 'ecuador-politica', 'ecuador', 1),
  ('Sucesos', 'ecuador-sucesos', 'ecuador', 2),
  ('Economía', 'ecuador-economia', 'ecuador', 3),
  ('Sociedad', 'ecuador-sociedad', 'ecuador', 4),
  ('Política internacional', 'mundo-politica', 'mundo', 1),
  ('Conflictos', 'mundo-conflictos', 'mundo', 2),
  ('Latinoamérica', 'mundo-latinoamerica', 'mundo', 3),
  ('Fútbol', 'futbol', 'deportes', 1),
  ('Selección y LigaPro', 'seleccion-ligapro', 'deportes', 2),
  ('Champions y Europa', 'champions-europa', 'deportes', 3),
  ('Otros deportes', 'otros-deportes', 'deportes', 4),
  ('IA', 'ia', 'tecnologia', 1),
  ('Software', 'software', 'tecnologia', 2),
  ('Gadgets y Hardware', 'hardware', 'tecnologia', 3),
  ('Ciberseguridad', 'ciberseguridad', 'tecnologia', 4),
  ('Música', 'musica', 'entretenimiento', 1),
  ('Cine y Series', 'cine-series', 'entretenimiento', 2),
  ('Virales e Internet', 'virales-internet', 'entretenimiento', 3),
  ('Famosos', 'famosos', 'entretenimiento', 4),
  ('Ciencia', 'ciencia', 'ciencia-y-salud', 1),
  ('Salud', 'salud', 'ciencia-y-salud', 2),
  ('Nutrición', 'nutricion', 'ciencia-y-salud', 3),
  ('Espacio', 'espacio', 'ciencia-y-salud', 4);
insert into public.categories (name, slug) select name, slug from _subs on conflict do nothing;
update public.categories c set parent_id = p.id, sort_order = s.ord
from _subs s join public.categories p on p.slug = s.parent_slug
where c.slug = s.slug;

update public.categories set sort_order = x.ord, parent_id = null
from (values ('ecuador',1),('mundo',2),('deportes',3),('tecnologia',4),('entretenimiento',5),('ciencia-y-salud',6),('tendencias',7)) as x(slug, ord)
where public.categories.slug = x.slug;

-- Cualquier otra categoría suelta sin ideas fuera de la estructura se elimina
delete from public.categories c
where c.parent_id is null
  and c.slug not in ('ecuador','mundo','deportes','tecnologia','entretenimiento','ciencia-y-salud','tendencias')
  and not exists (select 1 from public.ideas i where i.category_id = c.id);

select p.name as principal, coalesce(string_agg(c.name, ' · ' order by c.sort_order), '') as subcategorias
from public.categories p left join public.categories c on c.parent_id = p.id
where p.parent_id is null group by p.name, p.sort_order order by p.sort_order;
