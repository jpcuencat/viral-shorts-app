-- Add is_archived column to ideas table
ALTER TABLE "public"."ideas" 
ADD COLUMN "is_archived" boolean DEFAULT false;
