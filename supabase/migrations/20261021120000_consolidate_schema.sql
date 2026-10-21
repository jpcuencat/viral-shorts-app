-- Fase 1: consolidación idempotente del esquema.
-- Alinea las migraciones con lo que el código ya usa (tabla trends, ideas.source_trend_id,
-- scripts.user_id, reels.youtube_id). Se puede ejecutar varias veces sin romper nada.

-- 1. Tabla de tendencias procesadas
CREATE TABLE IF NOT EXISTS public.trends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    link TEXT,
    traffic TEXT,
    source TEXT,
    processed BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE public.trends ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.trends ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS trends_created_at_idx ON public.trends (created_at DESC);
CREATE INDEX IF NOT EXISTS trends_title_lower_idx ON public.trends (lower(title));

ALTER TABLE public.trends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read trends" ON public.trends;
CREATE POLICY "Authenticated read trends" ON public.trends
    FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated insert trends" ON public.trends;
CREATE POLICY "Authenticated insert trends" ON public.trends
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 2. Columnas que el código usa y no estaban en migraciones
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS source_trend_id UUID REFERENCES public.trends(id) ON DELETE SET NULL;
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE public.scripts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS youtube_id TEXT;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS quality_feedback TEXT;

-- Rellenar scripts.user_id desde la idea dueña
UPDATE public.scripts s SET user_id = i.user_id
FROM public.ideas i
WHERE s.idea_id = i.id AND s.user_id IS NULL;

-- 3. Índices para las consultas frecuentes
CREATE INDEX IF NOT EXISTS ideas_user_created_idx ON public.ideas (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ideas_category_idx ON public.ideas (category_id);
CREATE INDEX IF NOT EXISTS scripts_idea_idx ON public.scripts (idea_id);
CREATE INDEX IF NOT EXISTS reels_script_idx ON public.reels (script_id);
CREATE INDEX IF NOT EXISTS reel_scenes_reel_idx ON public.reel_scenes (reel_id);

-- 4. Política de inserción de categorías (process-trends las crea automáticamente)
DROP POLICY IF EXISTS "Authenticated users insert categories" ON public.categories;
CREATE POLICY "Authenticated users insert categories" ON public.categories
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 5. social-actions marca los reels como 'published'; el CHECK original no lo permitía
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_status_check;
ALTER TABLE public.reels ADD CONSTRAINT reels_status_check
    CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'published', 'scheduled'));
