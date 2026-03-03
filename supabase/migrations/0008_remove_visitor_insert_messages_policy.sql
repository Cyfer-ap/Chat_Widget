-- Migration 0008: remove RLS policy allowing visitors to insert messages
-- This ensures existing deployments which may have the policy still applied
-- will have it removed. New deployments already have the policy absent in
-- supabase/rls.sql, but existing DBs need an explicit migration to drop it.

drop policy if exists "Visitors can insert messages" on messages;

