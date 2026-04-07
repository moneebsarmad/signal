alter table public.policies
add column if not exists communication_bands text not null default '[]';
