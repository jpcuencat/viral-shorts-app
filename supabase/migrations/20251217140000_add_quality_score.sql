-- Add quality metrics to reels table
ALTER TABLE "public"."reels" 
ADD COLUMN "quality_score" integer DEFAULT NULL,
ADD COLUMN "quality_feedback" text DEFAULT NULL;
