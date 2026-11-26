-- Up Migration
ALTER TYPE public.invitation_status ADD VALUE IF NOT EXISTS 'expired';
