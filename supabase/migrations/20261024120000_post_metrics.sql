-- Métricas de cada publicación por red (YouTube, Instagram, Facebook, TikTok).
-- Las escribe la app (con clave de servicio) a partir de lo que reporta n8n; el usuario solo las lee.
CREATE TABLE IF NOT EXISTS public.post_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
    external_id TEXT NOT NULL,
    url TEXT,
    title TEXT,
    reel_id UUID REFERENCES public.reels(id) ON DELETE SET NULL,
    script_id UUID REFERENCES public.scripts(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    views BIGINT,
    likes BIGINT,
    comments BIGINT,
    shares BIGINT,
    saves BIGINT,
    extra JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS post_metrics_user_script_idx ON public.post_metrics (user_id, script_id);
ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_metrics: dueño lee" ON public.post_metrics;
CREATE POLICY "post_metrics: dueño lee" ON public.post_metrics FOR SELECT USING (auth.uid() = user_id);

-- Lecciones aprendidas del canal: las genera la app comparando qué rinde mejor y peor
-- (métricas reales + nota del crítico IA + correcciones del creador). Se inyectan en tendencias,
-- guiones y plan visual para que cada reel nuevo mejore con lo aprendido.
CREATE TABLE IF NOT EXISTS public.channel_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    insights JSONB NOT NULL,
    sample_size INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_insights_user_created_idx ON public.channel_insights (user_id, created_at DESC);
ALTER TABLE public.channel_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "channel_insights: dueño lee" ON public.channel_insights;
CREATE POLICY "channel_insights: dueño lee" ON public.channel_insights FOR SELECT USING (auth.uid() = user_id);
