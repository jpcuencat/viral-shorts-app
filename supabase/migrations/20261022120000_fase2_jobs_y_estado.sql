-- Fase 2: cola de trabajos con progreso real + estado de la app en la base (antes en JSON locales).
-- Idempotente: se puede ejecutar varias veces.

-- ============================================================
-- 1. COLA DE TRABAJOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    type TEXT NOT NULL CHECK (type IN ('generate_reel', 'process_trends')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    title TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    stage TEXT,
    message TEXT,
    result JSONB,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    locked_by TEXT,
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON public.jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_user_created_idx ON public.jobs (user_id, created_at DESC);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jobs: ver los propios" ON public.jobs;
CREATE POLICY "jobs: ver los propios" ON public.jobs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "jobs: encolar los propios" ON public.jobs;
CREATE POLICY "jobs: encolar los propios" ON public.jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id AND status = 'queued' AND progress = 0);
-- El usuario solo puede pedir la cancelación; el resto de columnas las actualiza el worker (service role)
DROP POLICY IF EXISTS "jobs: cancelar los propios" ON public.jobs;
CREATE POLICY "jobs: cancelar los propios" ON public.jobs FOR UPDATE
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE UPDATE ON public.jobs FROM authenticated;
GRANT UPDATE (cancel_requested) ON public.jobs TO authenticated;

-- Toma el siguiente trabajo en cola de forma atómica (varios workers no toman el mismo)
CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker TEXT)
RETURNS SETOF public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    UPDATE public.jobs j
       SET status = 'running', locked_by = p_worker, attempts = j.attempts + 1,
           started_at = COALESCE(j.started_at, now()), heartbeat_at = now(), updated_at = now(),
           stage = 'Iniciando', error = NULL
     WHERE j.id = (
        SELECT id FROM public.jobs
         WHERE status = 'queued' AND NOT cancel_requested
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
    RETURNING j.*;
END $$;

-- Recupera trabajos que quedaron "running" porque el servidor se detuvo (sin latido reciente)
CREATE OR REPLACE FUNCTION public.requeue_stale_jobs(p_stale_seconds INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
    UPDATE public.jobs
       SET status = CASE WHEN attempts < max_attempts AND NOT cancel_requested THEN 'queued' ELSE 'failed' END,
           error = CASE WHEN attempts < max_attempts AND NOT cancel_requested THEN NULL
                        ELSE 'Interrumpido: el servidor se detuvo durante el trabajo.' END,
           finished_at = CASE WHEN attempts < max_attempts AND NOT cancel_requested THEN NULL ELSE now() END,
           locked_by = NULL, stage = 'Reintentando tras interrupción', updated_at = now()
     WHERE status = 'running'
       AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => p_stale_seconds));
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.claim_next_job(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stale_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_job(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_jobs(INTEGER) TO service_role;

-- Progreso en vivo para la interfaz
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'jobs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
    END IF;
END $$;

-- ============================================================
-- 2. PUBLICACIONES (antes data/social-publications.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    reel_id UUID REFERENCES public.reels(id) ON DELETE SET NULL,
    script_id UUID REFERENCES public.scripts(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    video_url TEXT,
    platforms TEXT[] NOT NULL DEFAULT ARRAY['webhook'],
    results JSONB NOT NULL DEFAULT '[]'::jsonb,
    scheduled_at TIMESTAMPTZ,
    legacy_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publications_user_created_idx ON public.publications (user_id, created_at DESC);
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "publications: dueño" ON public.publications;
CREATE POLICY "publications: dueño" ON public.publications
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. AJUSTES DE PUBLICACIÓN (antes data/social-config.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    webhook_url TEXT,
    webhook_secret TEXT,
    public_base_url TEXT,
    default_hashtags TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings: dueño" ON public.app_settings;
CREATE POLICY "app_settings: dueño" ON public.app_settings
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4. ÍNDICE DEL VAULT (antes public/ai-vault/index.json). Los archivos siguen en disco.
--    Solo lo escribe el servidor (service role); los usuarios autenticados pueden leerlo.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vault_assets (
    file_name TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    category TEXT,
    subject_key TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    prompt TEXT,
    person_free BOOLEAN NOT NULL DEFAULT false,
    clip_check TEXT,
    clip_check_reason TEXT,
    source_video_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_assets_subject_idx ON public.vault_assets (subject_key, media_type);
ALTER TABLE public.vault_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vault_assets: lectura autenticados" ON public.vault_assets;
CREATE POLICY "vault_assets: lectura autenticados" ON public.vault_assets
    FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 5. DESGLOSE DE ESCENAS DE CADA REEL (antes public/output/manifest_<reel>.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reel_scene_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reel_id UUID NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
    scene_index INTEGER NOT NULL,
    text TEXT,
    caption TEXT,
    audio_path TEXT,
    image_path TEXT,
    public_media_url TEXT,
    subtitle_path TEXT,
    video_start_time NUMERIC NOT NULL DEFAULT 0,
    duration NUMERIC NOT NULL DEFAULT 0,
    subject_key TEXT,
    scene_tags TEXT[] NOT NULL DEFAULT '{}',
    hf_prompt TEXT,
    yt_search_query TEXT,
    source_label TEXT,
    real_person BOOLEAN NOT NULL DEFAULT false,
    person_free_prompt TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (reel_id, scene_index)
);
ALTER TABLE public.reel_scene_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reel_scene_assets: dueño del reel" ON public.reel_scene_assets;
CREATE POLICY "reel_scene_assets: dueño del reel" ON public.reel_scene_assets
    USING (EXISTS (SELECT 1 FROM public.reels r WHERE r.id = reel_scene_assets.reel_id AND r.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.reels r WHERE r.id = reel_scene_assets.reel_id AND r.user_id = auth.uid()));
