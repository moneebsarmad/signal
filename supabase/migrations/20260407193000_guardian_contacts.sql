create table if not exists public.guardian_contacts (
  id text primary key,
  student_id text not null references public.students (id),
  guardian_name text null,
  relationship text null,
  email text null,
  phone text null,
  is_primary boolean not null default false,
  allow_email boolean not null default true,
  source_type text not null default 'manual',
  source_record_id text null,
  last_synced_at text null,
  is_active boolean not null default true,
  notes text not null default ''
);

create index if not exists guardian_contacts_student_idx on public.guardian_contacts (student_id);
create index if not exists guardian_contacts_email_idx on public.guardian_contacts (email);
create index if not exists guardian_contacts_active_idx on public.guardian_contacts (is_active, allow_email);

alter table public.notifications
  add column if not exists guardian_contact_id text null references public.guardian_contacts (id);
