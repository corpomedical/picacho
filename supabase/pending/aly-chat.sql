-- Aly's own page, /app/chat (2026-09-29, operator: "We need a chat version
-- where it works exactly as chatgpt and anthropic… give people what no one
-- can" → layout A, every plan, Projects merged, the Generous allowance).
--
-- Idempotent. Run BEFORE the code push: until it runs, /app/chat says chat
-- isn't open yet and the sidebar row stays hidden (the flag row is missing).
--
-- Every table is read by its owner's session (SELECT only) and written by
-- the server with the service role, scoped to the user id it took from the
-- session — the same shape as producer.sql.

-- 1. Chats ------------------------------------------------------------------
create table if not exists public.aly_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text check (title is null or char_length(title) between 1 and 120),
  -- What this chat started with (system prompt version, project snapshot),
  -- kept for its whole life: the conversation is append-only so the brains'
  -- caches and Opus 5.5's thinking stay valid.
  setup jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists aly_chats_user_recent_idx
  on public.aly_chats (user_id, updated_at desc) where deleted_at is null;
create index if not exists aly_chats_project_idx
  on public.aly_chats (project_id) where deleted_at is null;

alter table public.aly_chats enable row level security;
drop policy if exists "Users read their own aly chats" on public.aly_chats;
create policy "Users read their own aly chats"
  on public.aly_chats for select
  using (auth.uid() = user_id);

-- 2. Messages ---------------------------------------------------------------
create table if not exists public.aly_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.aly_chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant')),
  -- claude | gpt | gemini | all (null on the person's own messages)
  brain text check (brain is null or brain in ('claude', 'gpt', 'gemini', 'all')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (chat_id, seq)
);

alter table public.aly_chat_messages drop constraint if exists aly_chat_messages_size_check;
alter table public.aly_chat_messages add constraint aly_chat_messages_size_check check (
  pg_column_size(content) <= 2000000
);

create index if not exists aly_chat_messages_chat_seq_idx
  on public.aly_chat_messages (chat_id, seq);

alter table public.aly_chat_messages enable row level security;
drop policy if exists "Users read their own aly chat messages" on public.aly_chat_messages;
create policy "Users read their own aly chat messages"
  on public.aly_chat_messages for select
  using (auth.uid() = user_id);

-- 3. Files (PDFs, spreadsheets, Word files, pictures, text) -----------------
create table if not exists public.aly_chat_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  chat_id uuid references public.aly_chats (id) on delete set null,
  project_id uuid references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  mime text not null,
  bytes int not null check (bytes > 0 and bytes <= 20971520),
  storage_path text not null,
  -- Words read out of a Word file, spreadsheet or text file (PDFs and
  -- pictures go to the brains as themselves).
  text_content text check (text_content is null or char_length(text_content) <= 2000000),
  ready boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists aly_chat_files_user_idx on public.aly_chat_files (user_id, created_at desc);
create index if not exists aly_chat_files_project_idx on public.aly_chat_files (project_id) where project_id is not null;

alter table public.aly_chat_files enable row level security;
drop policy if exists "Users read their own aly chat files" on public.aly_chat_files;
create policy "Users read their own aly chat files"
  on public.aly_chat_files for select
  using (auth.uid() = user_id);

-- 4. Documents Aly writes (the side panel) ----------------------------------
create table if not exists public.aly_chat_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  chat_id uuid not null references public.aly_chats (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null check (kind in ('document', 'code')),
  language text check (language is null or char_length(language) <= 30),
  content text not null check (char_length(content) <= 400000),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aly_chat_docs_chat_idx on public.aly_chat_docs (chat_id, created_at);

alter table public.aly_chat_docs enable row level security;
drop policy if exists "Users read their own aly chat docs" on public.aly_chat_docs;
create policy "Users read their own aly chat docs"
  on public.aly_chat_docs for select
  using (auth.uid() = user_id);

-- 5. A project's instructions for Aly ----------------------------------------
alter table public.projects add column if not exists aly_instructions text;
alter table public.projects drop constraint if exists projects_aly_instructions_check;
alter table public.projects add constraint projects_aly_instructions_check check (
  aly_instructions is null or char_length(aly_instructions) <= 4000
);

-- 6. The files bucket: private, no storage policy at all. The server hands
--    out one signed upload per file (path chosen by the server, under the
--    person's own folder) and reads the bytes back with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aly-files',
  'aly-files',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 7. The switch -------------------------------------------------------------
insert into public.feature_flags (key, enabled, description)
values (
  'aly_chat',
  true,
  'Aly''s own chat page (/app/chat) for every plan: Claude, GPT and Gemini, files, documents, projects. Off = the page says chat is closed and every turn is refused.'
)
on conflict (key) do nothing;
