-- Create Reels Table
CREATE TABLE IF NOT EXISTS public.reels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
    export_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create Reel Scenes Table
CREATE TABLE IF NOT EXISTS public.reel_scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reel_id UUID NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
    scene_order INTEGER NOT NULL,
    content_text TEXT,
    image_prompt TEXT,
    image_url TEXT,
    audio_url TEXT,
    duration NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_scenes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own reels" ON public.reels 
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own reels" ON public.reels 
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own reels" ON public.reels 
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own reels" ON public.reels 
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own reel scenes" ON public.reel_scenes 
    FOR SELECT USING (
        EXISTS ( SELECT 1 FROM public.reels WHERE reels.id = reel_scenes.reel_id AND reels.user_id = auth.uid() )
    );

CREATE POLICY "Users can insert their own reel scenes" ON public.reel_scenes 
    FOR INSERT WITH CHECK (
        EXISTS ( SELECT 1 FROM public.reels WHERE reels.id = reel_scenes.reel_id AND reels.user_id = auth.uid() )
    );

CREATE POLICY "Users can update their own reel scenes" ON public.reel_scenes 
    FOR UPDATE USING (
        EXISTS ( SELECT 1 FROM public.reels WHERE reels.id = reel_scenes.reel_id AND reels.user_id = auth.uid() )
    );

CREATE POLICY "Users can delete their own reel scenes" ON public.reel_scenes 
    FOR DELETE USING (
        EXISTS ( SELECT 1 FROM public.reels WHERE reels.id = reel_scenes.reel_id AND reels.user_id = auth.uid() )
    );
