-- Inkcut: let a project use an art style the user describes in their own words.
-- style_id = 'custom' means the image look comes from custom_style.
-- Safe to run more than once.

alter table public.projects
  add column if not exists custom_style text;

alter table public.projects
  drop constraint if exists projects_custom_style_len;

alter table public.projects
  add constraint projects_custom_style_len
  check (custom_style is null or char_length(custom_style) between 3 and 200);
