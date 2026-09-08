-- Picacho public schema snapshot — generated 2026-09-07, policies/indexes/grants
-- for the two tables added that day filled in 2026-09-09. The 09-07 re-snapshot
-- inserted only their table blocks; the policies ("reels read own", "signals
-- read own") and indexes are copied verbatim from applied/2026-09-07/, and the
-- grants are the platform defaults every other table here carries — evidenced,
-- not read from pg_class: an anonymous key gets 200 [] from both tables rather
-- than 42501, which is what a granted-but-policy-filtered read looks like.
-- Read directly from the live database's catalogs (see supabase/README.md).
-- Reference document: the applied/ SQL files remain the change history.

-- extension: pg_stat_statements (v1.11)
-- extension: pgcrypto (v1.3)
-- extension: supabase_vault (v0.3.1)
-- extension: uuid-ossp (v1.1)

create table public.admin_push_subscriptions (
  "endpoint" text not null,
  "user_id" uuid not null,
  "p256dh" text not null,
  "auth" text not null,
  "created_at" timestamp with time zone default now() not null,
  "last_used_at" timestamp with time zone,
  constraint "admin_push_subscriptions_pkey" PRIMARY KEY (endpoint),
  constraint "admin_push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.admin_push_subscriptions enable row level security;

create table public.agent_usage (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "mode" text not null,
  "units" integer not null,
  "cost_usd" numeric(10,6) default 0 not null,
  "input_tokens" integer default 0 not null,
  "cache_read_tokens" integer default 0 not null,
  "cache_write_tokens" integer default 0 not null,
  "output_tokens" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "agent_usage_pkey" PRIMARY KEY (id),
  constraint "agent_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.agent_usage enable row level security;

create table public.api_keys (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "name" text not null,
  "prefix" text not null,
  "key_hash" text not null,
  "created_at" timestamp with time zone default now() not null,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  constraint "api_keys_key_hash_key" UNIQUE (key_hash),
  constraint "api_keys_pkey" PRIMARY KEY (id),
  constraint "api_keys_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "api_keys_name_check" CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);
alter table public.api_keys enable row level security;

create table public.api_rate_hits (
  "id" bigint default nextval('api_rate_hits_id_seq'::regclass) not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "scope" text default 'legacy'::text not null,
  constraint "api_rate_hits_pkey" PRIMARY KEY (id)
);
alter table public.api_rate_hits enable row level security;

create table public.app_settings (
  "key" text not null,
  "value" text not null,
  "description" text,
  "updated_at" timestamp with time zone default now() not null,
  constraint "app_settings_pkey" PRIMARY KEY (key)
);
alter table public.app_settings enable row level security;

create table public.brand_rules (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "kind" text not null,
  "label" text not null,
  "value" text not null,
  "applies_to" text default 'all'::text not null,
  "severity" text default 'block'::text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "brand_rules_pkey" PRIMARY KEY (id),
  constraint "brand_rules_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "brand_rules_applies_to_check" CHECK ((applies_to = ANY (ARRAY['all'::text, 'image'::text, 'video'::text]))),
  constraint "brand_rules_kind_check" CHECK ((kind = ANY (ARRAY['require'::text, 'forbid'::text]))),
  constraint "brand_rules_severity_check" CHECK ((severity = ANY (ARRAY['block'::text, 'warn'::text])))
);
alter table public.brand_rules enable row level security;

create table public.character_profiles (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "name" text not null,
  "reference_image_urls" text[] default '{}'::text[] not null,
  "traits" jsonb default '{}'::jsonb not null,
  "motion_style" text,
  "voice_tone_tags" text[] default '{}'::text[] not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "project_id" uuid,
  "voice_id" uuid,
  "outfit_image_urls" text[] default '{}'::text[] not null,
  "outfit_description" text,
  "render_style" text,
  constraint "character_profiles_pkey" PRIMARY KEY (id),
  constraint "character_profiles_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  constraint "character_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint "character_profiles_voice_id_fkey" FOREIGN KEY (voice_id) REFERENCES voice_presets(id) ON DELETE SET NULL,
  constraint "character_profiles_render_style_check" CHECK ((render_style = ANY (ARRAY['photoreal'::text, 'illustrated'::text])))
);
alter table public.character_profiles enable row level security;

create table public.character_profiles_backup_20260814 (
  "id" uuid,
  "user_id" uuid,
  "name" text,
  "reference_image_urls" text[],
  "traits" jsonb,
  "motion_style" text,
  "voice_tone_tags" text[],
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "project_id" uuid,
  "voice_id" uuid
);
alter table public.character_profiles_backup_20260814 enable row level security;

create table public.community_hearts (
  "post_id" uuid not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "community_hearts_pkey" PRIMARY KEY (post_id, user_id),
  constraint "community_hearts_post_id_fkey" FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  constraint "community_hearts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.community_hearts enable row level security;

create table public.community_moderation (
  "generation_id" uuid not null,
  "hidden_by" uuid,
  "hidden_at" timestamp with time zone default now() not null,
  "reason" text,
  constraint "community_moderation_pkey" PRIMARY KEY (generation_id)
);
alter table public.community_moderation enable row level security;

create table public.community_posts (
  "id" uuid default gen_random_uuid() not null,
  "generation_id" uuid not null,
  "user_id" uuid not null,
  "username" text,
  "caption" text,
  "media_url" text not null,
  "content_type" text default 'image'::text not null,
  "prompt" text,
  "hearts_count" integer default 0 not null,
  "views_count" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "hidden_at" timestamp with time zone,
  "match_score" integer,
  "character_name" text,
  constraint "community_posts_generation_id_key" UNIQUE (generation_id),
  constraint "community_posts_pkey" PRIMARY KEY (id),
  constraint "community_posts_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  constraint "community_posts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint "community_posts_content_type_check" CHECK ((content_type = ANY (ARRAY['image'::text, 'video'::text])))
);
alter table public.community_posts enable row level security;

create table public.community_views (
  "post_id" uuid not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "community_views_pkey" PRIMARY KEY (post_id, user_id),
  constraint "community_views_post_id_fkey" FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  constraint "community_views_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.community_views enable row level security;

create table public.credit_purchases (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "credits" integer not null,
  "amount_cents" integer not null,
  "currency" text not null,
  "stripe_session_id" text,
  "created_at" timestamp with time zone default now() not null,
  "refunded_at" timestamp with time zone,
  constraint "credit_purchases_stripe_session_id_key" UNIQUE (stripe_session_id),
  constraint "credit_purchases_pkey" PRIMARY KEY (id),
  constraint "credit_purchases_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "credit_purchases_credits_check" CHECK ((credits > 0))
);
alter table public.credit_purchases enable row level security;

create table public.drip_sends (
  "user_id" uuid not null,
  "template" text not null,
  "sent_at" timestamp with time zone default now() not null,
  constraint "drip_sends_pkey" PRIMARY KEY (user_id, template),
  constraint "drip_sends_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.drip_sends enable row level security;

create table public.email_sends (
  "id" uuid default gen_random_uuid() not null,
  "template_key" text,
  "subject" text,
  "audience" text,
  "recipient_count" integer,
  "sent_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  constraint "email_sends_pkey" PRIMARY KEY (id)
);
alter table public.email_sends enable row level security;

create table public.email_templates (
  "id" uuid default gen_random_uuid() not null,
  "key" text not null,
  "subject" text not null,
  "body" text not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" uuid,
  constraint "email_templates_key_key" UNIQUE (key),
  constraint "email_templates_pkey" PRIMARY KEY (id)
);
alter table public.email_templates enable row level security;

create table public.feature_flags (
  "key" text not null,
  "enabled" boolean default false not null,
  "description" text,
  "updated_at" timestamp with time zone default now() not null,
  constraint "feature_flags_pkey" PRIMARY KEY (key)
);
alter table public.feature_flags enable row level security;

create table public.feedback (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "message" text not null,
  "status" text default 'open'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "rating" integer,
  constraint "feedback_pkey" PRIMARY KEY (id),
  constraint "feedback_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint "feedback_rating_check" CHECK (((rating IS NULL) OR ((rating >= 1) AND (rating <= 5)))),
  constraint "feedback_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);
alter table public.feedback enable row level security;

create table public.generation_jobs (
  "generation_id" uuid not null,
  "user_id" uuid not null,
  "stage" text not null,
  "provider_request_id" text,
  "status_url" text,
  "response_url" text,
  "cancel_url" text,
  "payload" jsonb default '{}'::jsonb not null,
  "resume" jsonb default '{}'::jsonb not null,
  "started_at" timestamp with time zone default now() not null,
  "last_polled_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "advance_lock" uuid,
  "advance_locked_at" timestamp with time zone,
  constraint "generation_jobs_pkey" PRIMARY KEY (generation_id),
  constraint "generation_jobs_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  constraint "generation_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.generation_jobs enable row level security;

create table public.generation_layers (
  "id" uuid default gen_random_uuid() not null,
  "generation_id" uuid not null,
  "user_id" uuid not null,
  "z_index" integer not null,
  "name" text,
  "description" text,
  "bbox" jsonb,
  "storage_path" text not null,
  "width" integer,
  "height" integer,
  "identity_score" integer,
  "source_layer_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "version" integer default 1 not null,
  "prompt" text,
  constraint "generation_layers_pkey" PRIMARY KEY (id),
  constraint "generation_layers_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  constraint "generation_layers_source_layer_id_fkey" FOREIGN KEY (source_layer_id) REFERENCES generation_layers(id) ON DELETE SET NULL,
  constraint "generation_layers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.generation_layers enable row level security;

create table public.generation_reports (
  "id" uuid default gen_random_uuid() not null,
  "generation_id" uuid,
  "user_id" uuid not null,
  "reason" text not null,
  "details" text,
  "status" text default 'open'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "source" text default 'user'::text not null,
  constraint "generation_reports_pkey" PRIMARY KEY (id),
  constraint "generation_reports_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  constraint "generation_reports_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint "generation_reports_source_check" CHECK ((source = ANY (ARRAY['user'::text, 'auto'::text, 'community'::text]))),
  constraint "generation_reports_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);
alter table public.generation_reports enable row level security;

create table public.generation_signals (
  "id" uuid default gen_random_uuid() not null,
  "generation_id" uuid not null,
  "user_id" uuid not null,
  "kind" text not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "generation_signals_pkey" PRIMARY KEY (id),
  constraint "generation_signals_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  constraint "generation_signals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "generation_signals_kind_check" CHECK ((kind = ANY (ARRAY['downloaded'::text, 'continued'::text, 'shared'::text, 'opened'::text, 'deleted'::text])))
);
alter table public.generation_signals enable row level security;

create table public.generations (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "character_profile_id" uuid,
  "prompt_input" text not null,
  "status" text default 'drafted'::text not null,
  "attempts" integer default 0 not null,
  "result_url" text,
  "pipeline_log" jsonb default '[]'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "content_type" text default 'video'::text not null,
  "angle_group_id" uuid,
  "angle" text,
  "cancel_requested" boolean default false not null,
  "video_model_id" text,
  "credits_used" integer default 1 not null,
  "feedback" text,
  "video_duration_seconds" integer,
  "video_aspect_ratio" text,
  "character_profile_ids" uuid[] default '{}'::uuid[] not null,
  "progress_stage" text,
  "purchased_credits_used" integer default 0 not null,
  "free_generation_used" boolean default false not null,
  "match_score" smallint,
  "match_notes" text,
  "deleted_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "featured_at" timestamp with time zone,
  "model_id" text,
  "attachments" jsonb,
  "identity_retries" integer,
  "identity_gated_at" timestamp with time zone,
  "source_generation_id" uuid,
  "poster_url" text,
  constraint "generations_pkey" PRIMARY KEY (id),
  constraint "generations_character_profile_id_fkey" FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE SET NULL,
  constraint "generations_source_generation_id_fkey" FOREIGN KEY (source_generation_id) REFERENCES generations(id) ON DELETE SET NULL,
  constraint "generations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint "generations_content_type_check" CHECK ((content_type = ANY (ARRAY['video'::text, 'image'::text]))),
  constraint "generations_credits_used_nonneg" CHECK (((credits_used IS NULL) OR (credits_used >= 0))),
  constraint "generations_feedback_check" CHECK ((feedback = ANY (ARRAY['like'::text, 'dislike'::text]))),
  constraint "generations_purchased_credits_used_nonneg" CHECK (((purchased_credits_used IS NULL) OR (purchased_credits_used >= 0))),
  constraint "generations_status_check" CHECK ((status = ANY (ARRAY['drafted'::text, 'reviewed'::text, 'generating'::text, 'validated'::text, 'succeeded'::text, 'failed'::text])))
);
alter table public.generations enable row level security;

create table public.model_health (
  "model_id" text not null,
  "kind" text not null,
  "consecutive_failures" integer default 0 not null,
  "last_error" text,
  "last_failure_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "tripped_at" timestamp with time zone,
  "retry_after" timestamp with time zone,
  "trip_count" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "failing_user_ids" uuid[] default '{}'::uuid[] not null,
  constraint "model_health_pkey" PRIMARY KEY (model_id),
  constraint "model_health_kind_check" CHECK ((kind = ANY (ARRAY['video'::text, 'image'::text])))
);
alter table public.model_health enable row level security;

create table public.notes (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "title" text default 'Untitled note'::text not null,
  "body" text default ''::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "notes_pkey" PRIMARY KEY (id),
  constraint "notes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.notes enable row level security;

create table public.page_views (
  "id" uuid default gen_random_uuid() not null,
  "path" text not null,
  "visitor_id" text not null,
  "user_id" uuid,
  "country" text,
  "referrer" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "page_views_pkey" PRIMARY KEY (id),
  constraint "page_views_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);
alter table public.page_views enable row level security;

create table public.products (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "name" text not null,
  "image_paths" text[] default '{}'::text[] not null,
  "logo_path" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "products_pkey" PRIMARY KEY (id),
  constraint "products_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.products enable row level security;

create table public.profiles (
  "id" uuid not null,
  "email" text not null,
  "role" text default 'user'::text not null,
  "plan" text default 'none'::text not null,
  "status" text default 'active'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "username" text not null,
  "company" text,
  "gender" text,
  "last_seen_at" timestamp with time zone,
  "terms_accepted_at" timestamp with time zone,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_price_id" text,
  "plan_status" text default 'inactive'::text not null,
  "skip_ai_refinement" boolean default false not null,
  "has_completed_onboarding" boolean default false not null,
  "bonus_credits" integer default 0 not null,
  "free_reference_generations_used" integer default 0 not null,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "purchased_credits" integer default 0 not null,
  "rating_prompted_at" timestamp with time zone,
  "free_generations_used" integer default 0 not null,
  "session_started_at" timestamp with time zone,
  "session_seconds" integer default 0 not null,
  "total_active_seconds" bigint default 0 not null,
  "promo_code" text,
  "referred_by" uuid,
  "full_name" text,
  "api_access" boolean default false not null,
  "plan_currency" text,
  "plan_interval" text,
  "marketing_opt_out" boolean default false not null,
  "free_generation_last_at" timestamp with time zone,
  "plan_source" text,
  "play_product_id" text,
  "referral_rewarded_at" timestamp with time zone,
  "promo_rep" text,
  constraint "profiles_pkey" PRIMARY KEY (id),
  constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "profiles_referred_by_fkey" FOREIGN KEY (referred_by) REFERENCES profiles(id) ON DELETE SET NULL,
  constraint "profiles_bonus_credits_non_negative" CHECK ((bonus_credits >= 0)),
  constraint "profiles_free_reference_generations_used_non_negative" CHECK ((free_reference_generations_used >= 0)),
  constraint "profiles_plan_check" CHECK ((plan = ANY (ARRAY['none'::text, 'basic'::text, 'starter'::text, 'growth'::text, 'studio'::text, 'elite'::text]))),
  constraint "profiles_plan_source_check" CHECK ((plan_source = ANY (ARRAY['stripe'::text, 'play'::text]))),
  constraint "profiles_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text]))),
  constraint "profiles_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text]))),
  constraint "profiles_username_format" CHECK (((username IS NULL) OR (username ~ '^[a-z0-9_]{3,24}$'::text))) NOT VALID
);
alter table public.profiles enable row level security;

create table public.projects (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "name" text not null,
  "description" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "is_starred" boolean default false not null,
  "is_pinned" boolean default false not null,
  "is_archived" boolean default false not null,
  constraint "projects_pkey" PRIMARY KEY (id),
  constraint "projects_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
alter table public.projects enable row level security;

create table public.promo_codes (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "rep_name" text not null,
  "discount_percent" integer not null,
  "duration_months" integer default 3 not null,
  "commission_percent" integer default 10 not null,
  "active" boolean default true not null,
  "stripe_coupon_id" text,
  "stripe_promotion_code_id" text,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "promo_codes_code_key" UNIQUE (code),
  constraint "promo_codes_pkey" PRIMARY KEY (id),
  constraint "promo_codes_commission_percent_check" CHECK (((commission_percent >= 0) AND (commission_percent <= 100))),
  constraint "promo_codes_discount_percent_check" CHECK (((discount_percent >= 1) AND (discount_percent <= 100))),
  constraint "promo_codes_duration_months_check" CHECK (((duration_months >= 0) AND (duration_months <= 36)))
);
alter table public.promo_codes enable row level security;

create table public.promo_redemptions (
  "id" uuid default gen_random_uuid() not null,
  "promo_code_id" uuid,
  "code" text not null,
  "rep_name" text not null,
  "user_id" uuid,
  "user_email" text,
  "amount_subtotal" integer default 0 not null,
  "amount_total" integer default 0 not null,
  "discount_amount" integer default 0 not null,
  "currency" text default 'eur'::text not null,
  "stripe_session_id" text not null,
  "created_at" timestamp with time zone default now() not null,
  "commission_percent" integer,
  constraint "promo_redemptions_stripe_session_id_key" UNIQUE (stripe_session_id),
  constraint "promo_redemptions_pkey" PRIMARY KEY (id),
  constraint "promo_redemptions_promo_code_id_fkey" FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE SET NULL,
  constraint "promo_redemptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL
);
alter table public.promo_redemptions enable row level security;

create table public.prompt_assists (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "kind" text not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "prompt_assists_pkey" PRIMARY KEY (id),
  constraint "prompt_assists_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "prompt_assists_kind_check" CHECK ((kind = ANY (ARRAY['enhance'::text, 'from_image'::text])))
);
alter table public.prompt_assists enable row level security;

create table public.push_tokens (
  "token" text not null,
  "user_id" uuid not null,
  "platform" text not null,
  "created_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "locale" text,
  constraint "push_tokens_pkey" PRIMARY KEY (token),
  constraint "push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "push_tokens_platform_check" CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);
alter table public.push_tokens enable row level security;

create table public.reference_image_generations (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "character_profile_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  constraint "reference_image_generations_pkey" PRIMARY KEY (id),
  constraint "reference_image_generations_character_profile_id_fkey" FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE SET NULL,
  constraint "reference_image_generations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.reference_image_generations enable row level security;

create table public.saved_prompts (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "character_profile_id" uuid,
  "content_type" text default 'image'::text not null,
  "prompt" text not null,
  "source_input" text,
  "source" text default 'enhance'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "last_used_at" timestamp with time zone,
  constraint "saved_prompts_pkey" PRIMARY KEY (id),
  constraint "saved_prompts_character_profile_id_fkey" FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE SET NULL,
  constraint "saved_prompts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "saved_prompts_content_type_check" CHECK ((content_type = ANY (ARRAY['image'::text, 'video'::text]))),
  constraint "saved_prompts_prompt_check" CHECK (((char_length(prompt) >= 1) AND (char_length(prompt) <= 4000))),
  constraint "saved_prompts_source_check" CHECK ((source = ANY (ARRAY['enhance'::text, 'from_image'::text, 'manual'::text]))),
  constraint "saved_prompts_source_input_check" CHECK ((char_length(source_input) <= 2000))
);
alter table public.saved_prompts enable row level security;

create table public.user_reels (
  "user_id" uuid not null,
  "storage_path" text not null,
  "poster_path" text,
  "character_profile_id" uuid,
  "clip_generation_ids" uuid[] default '{}'::uuid[] not null,
  "duration_seconds" integer default 0 not null,
  "byte_size" integer,
  "takes" integer,
  "mean_identity" smallint,
  "built_at" timestamp with time zone default now() not null,
  "clips" jsonb default '[]'::jsonb not null,
  constraint "user_reels_pkey" PRIMARY KEY (user_id),
  constraint "user_reels_character_profile_id_fkey" FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE SET NULL,
  constraint "user_reels_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint "user_reels_duration_sane" CHECK (((duration_seconds >= 0) AND (duration_seconds <= 60)))
);
alter table public.user_reels enable row level security;

create table public.voice_presets (
  "id" uuid default gen_random_uuid() not null,
  "label" text not null,
  "description" text,
  "elevenlabs_voice_id" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "voice_presets_pkey" PRIMARY KEY (id)
);
alter table public.voice_presets enable row level security;

CREATE INDEX agent_usage_user_created_idx ON public.agent_usage USING btree (user_id, created_at DESC);
CREATE INDEX api_keys_hash_idx ON public.api_keys USING btree (key_hash) WHERE (revoked_at IS NULL);
CREATE INDEX api_keys_user_idx ON public.api_keys USING btree (user_id, created_at DESC);
CREATE INDEX api_rate_hits_user_scope_time ON public.api_rate_hits USING btree (user_id, scope, created_at);
CREATE INDEX brand_rules_user_id_idx ON public.brand_rules USING btree (user_id);
CREATE INDEX character_profiles_project_id_idx ON public.character_profiles USING btree (project_id);
CREATE INDEX idx_character_profiles_user_id ON public.character_profiles USING btree (user_id);
CREATE INDEX idx_character_profiles_voice_id ON public.character_profiles USING btree (voice_id);
CREATE INDEX community_posts_new ON public.community_posts USING btree (created_at DESC) WHERE (hidden_at IS NULL);
CREATE INDEX community_posts_top ON public.community_posts USING btree (hearts_count DESC, created_at DESC) WHERE (hidden_at IS NULL);
CREATE INDEX credit_purchases_user_id_idx ON public.credit_purchases USING btree (user_id);
CREATE INDEX idx_feedback_user_id ON public.feedback USING btree (user_id);
CREATE INDEX generation_jobs_last_polled_idx ON public.generation_jobs USING btree (last_polled_at);
CREATE UNIQUE INDEX generation_jobs_provider_request_id_key ON public.generation_jobs USING btree (provider_request_id) WHERE (provider_request_id IS NOT NULL);
CREATE INDEX generation_jobs_user_idx ON public.generation_jobs USING btree (user_id);
CREATE INDEX generation_layers_generation_id_idx ON public.generation_layers USING btree (generation_id);
CREATE INDEX generation_layers_newest_idx ON public.generation_layers USING btree (generation_id, z_index, version DESC);
CREATE UNIQUE INDEX generation_layers_version_key ON public.generation_layers USING btree (generation_id, z_index, version);
CREATE INDEX generation_reports_generation_id_idx ON public.generation_reports USING btree (generation_id);
CREATE INDEX generation_reports_status_idx ON public.generation_reports USING btree (status);
CREATE INDEX generation_reports_user_id_idx ON public.generation_reports USING btree (user_id);
CREATE INDEX generation_signals_generation_idx ON public.generation_signals USING btree (generation_id, kind);
CREATE INDEX generation_signals_user_idx ON public.generation_signals USING btree (user_id, created_at desc);
CREATE UNIQUE INDEX generation_signals_unique ON public.generation_signals USING btree (generation_id, kind);
CREATE INDEX generations_angle_group_id_idx ON public.generations USING btree (angle_group_id) WHERE (angle_group_id IS NOT NULL);
CREATE UNIQUE INDEX generations_angle_group_unique ON public.generations USING btree (user_id, angle_group_id, angle) WHERE (angle_group_id IS NOT NULL);
CREATE INDEX generations_featured ON public.generations USING btree (featured_at DESC) WHERE (featured_at IS NOT NULL);
CREATE INDEX generations_generating_by_user ON public.generations USING btree (user_id, created_at) WHERE (status = 'generating'::text);
CREATE INDEX generations_model_id_match_score_idx ON public.generations USING btree (model_id, match_score) WHERE (match_score IS NOT NULL);
CREATE INDEX generations_refunds_by_user ON public.generations USING btree (user_id, refunded_at) WHERE (refunded_at IS NOT NULL);
CREATE INDEX generations_source_generation_id_idx ON public.generations USING btree (source_generation_id) WHERE (source_generation_id IS NOT NULL);
CREATE INDEX generations_user_visible_idx ON public.generations USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_generations_character_profile_id ON public.generations USING btree (character_profile_id);
CREATE INDEX idx_generations_user_id ON public.generations USING btree (user_id);
CREATE INDEX notes_user_id_updated_at_idx ON public.notes USING btree (user_id, updated_at DESC);
CREATE INDEX page_views_created_at_idx ON public.page_views USING btree (created_at DESC);
CREATE INDEX page_views_user_id_idx ON public.page_views USING btree (user_id);
CREATE INDEX page_views_visitor_id_idx ON public.page_views USING btree (visitor_id);
CREATE INDEX profiles_referred_by_idx ON public.profiles USING btree (referred_by) WHERE (referred_by IS NOT NULL);
CREATE UNIQUE INDEX profiles_stripe_customer_id_idx ON public.profiles USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);
CREATE UNIQUE INDEX profiles_stripe_subscription_id_idx ON public.profiles USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);
CREATE UNIQUE INDEX profiles_username_lower_key ON public.profiles USING btree (lower(username));
CREATE INDEX idx_projects_user_id ON public.projects USING btree (user_id);
CREATE INDEX promo_redemptions_code_idx ON public.promo_redemptions USING btree (promo_code_id);
CREATE INDEX prompt_assists_user_created_idx ON public.prompt_assists USING btree (user_id, created_at DESC);
CREATE INDEX push_tokens_user_idx ON public.push_tokens USING btree (user_id);
CREATE INDEX idx_reference_image_generations_character_profile_id ON public.reference_image_generations USING btree (character_profile_id);
CREATE INDEX reference_image_generations_user_created_idx ON public.reference_image_generations USING btree (user_id, created_at DESC);
CREATE INDEX saved_prompts_user_created_idx ON public.saved_prompts USING btree (user_id, created_at DESC);
CREATE INDEX user_reels_built_at_idx ON public.user_reels USING btree (built_at);

CREATE OR REPLACE FUNCTION public.add_purchased_credits(p_user_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.profiles
     set purchased_credits = coalesce(purchased_credits,0) + p_amount
   where id = p_user_id and p_amount <> 0;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_content_adoption()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'note_users', (SELECT count(DISTINCT user_id) FROM public.notes),
    'project_users', (SELECT count(DISTINCT user_id) FROM public.projects),
    'character_users', (SELECT count(DISTINCT user_id) FROM public.character_profiles)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_daily_series(p_days integer DEFAULT 14)
 RETURNS TABLE(day date, signups bigint, generations bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT d.day::date,
         (SELECT count(*) FROM public.profiles p
           WHERE p.created_at >= d.day AND p.created_at < d.day + interval '1 day'),
         (SELECT count(*) FROM public.generations g
           WHERE g.created_at >= d.day AND g.created_at < d.day + interval '1 day')
  FROM generate_series(
         (current_date - (greatest(p_days, 1) - 1) * interval '1 day')::date,
         current_date,
         interval '1 day'
       ) AS d(day)
  ORDER BY d.day;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_generation_stats(p_month_start timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', count(*),
    'succeeded', count(*) FILTER (WHERE status = 'succeeded'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'video', count(*) FILTER (WHERE content_type = 'video'),
    'image', count(*) FILTER (WHERE content_type = 'image'),
    'credits_this_month', coalesce(sum(
        CASE WHEN created_at >= p_month_start
             THEN CASE WHEN credits_used IS NULL THEN 1 ELSE credits_used END
             ELSE 0 END), 0),
    'distinct_users', count(DISTINCT user_id),
    'distinct_video_users', count(DISTINCT user_id) FILTER (WHERE content_type = 'video'),
    'distinct_image_users', count(DISTINCT user_id) FILTER (WHERE content_type = 'image'),
    -- System health is measured over terminal rows only (a still-running
    -- generation is not evidence either way).
    'terminal_total', count(*) FILTER (WHERE status IN ('succeeded','failed')),
    'terminal_failed', count(*) FILTER (WHERE status = 'failed'),
    'terminal_attempts_sum', coalesce(sum(attempts) FILTER (WHERE status IN ('succeeded','failed')), 0)
  )
  FROM public.generations;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_profile_stats(p_standard_genders text[] DEFAULT ARRAY[]::text[], p_top_companies integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.profiles),
    'new_7d', (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days'),
    'active_subscribers', (SELECT count(*) FROM public.profiles WHERE plan_status = 'active'),
    'suspended', (SELECT count(*) FROM public.profiles WHERE status = 'suspended'),
    'online_now', (SELECT count(*) FROM public.profiles WHERE last_seen_at >= now() - interval '5 minutes'),
    'plan_distribution', coalesce((
      SELECT jsonb_agg(jsonb_build_object('plan', plan, 'n', n))
      FROM (SELECT coalesce(plan, 'none') AS plan, count(*) AS n
              FROM public.profiles GROUP BY 1) s
    ), '[]'::jsonb),
    -- Active subscribers grouped by plan AND price id, so TypeScript can apply
    -- its own price table and currency-per-price-id mapping without this
    -- function knowing anything about pricing.
    'active_by_plan_price', coalesce((
      SELECT jsonb_agg(jsonb_build_object('plan', plan, 'stripe_price_id', stripe_price_id, 'n', n))
      FROM (SELECT coalesce(plan, 'none') AS plan, stripe_price_id, count(*) AS n
              FROM public.profiles WHERE plan_status = 'active' GROUP BY 1, 2) s
    ), '[]'::jsonb),
    'gender_buckets', coalesce((
      SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n))
      FROM (SELECT CASE
                     WHEN gender IS NULL OR btrim(gender) = '' THEN 'Not specified'
                     WHEN gender = ANY(p_standard_genders) THEN gender
                     ELSE 'Self-described'
                   END AS bucket,
                   count(*) AS n
              FROM public.profiles GROUP BY 1) s
    ), '[]'::jsonb),
    'company_filled', (SELECT count(*) FROM public.profiles WHERE company IS NOT NULL AND btrim(company) <> ''),
    'top_companies', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', company, 'count', n) ORDER BY n DESC)
      FROM (SELECT company, count(*) AS n
              FROM public.profiles
             WHERE company IS NOT NULL AND btrim(company) <> ''
             GROUP BY 1 ORDER BY count(*) DESC
             LIMIT greatest(p_top_companies, 1)) s
    ), '[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_queue_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'open_reports_auto', (SELECT count(*) FROM public.generation_reports WHERE status = 'open' AND source = 'auto'),
    'open_reports_user', (SELECT count(*) FROM public.generation_reports WHERE status = 'open' AND source IS DISTINCT FROM 'auto'),
    'open_feedback', (SELECT count(*) FROM public.feedback WHERE status = 'open')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_traffic_breakdown(p_days integer DEFAULT 30, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH win AS (
    SELECT * FROM public.page_views
     WHERE created_at >= now() - (greatest(p_days, 1) || ' days')::interval
  )
  SELECT jsonb_build_object(
    'views', (SELECT count(*) FROM win),
    'visitors', (SELECT count(DISTINCT visitor_id) FROM win),
    'top_paths', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', path, 'count', n) ORDER BY n DESC)
      FROM (SELECT path, count(*) AS n FROM win GROUP BY 1 ORDER BY count(*) DESC LIMIT greatest(p_limit,1)) s
    ), '[]'::jsonb),
    'top_countries', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', country, 'count', n) ORDER BY n DESC)
      FROM (SELECT country, count(*) AS n FROM win GROUP BY 1 ORDER BY count(*) DESC LIMIT greatest(p_limit,1)) s
    ), '[]'::jsonb),
    'top_referrers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('label', host, 'count', n) ORDER BY n DESC)
      FROM (
        SELECT host, count(*) AS n
        FROM (
          SELECT NULLIF(
                   regexp_replace(
                     regexp_replace(
                       regexp_replace(coalesce(referrer, ''), '^[a-zA-Z][a-zA-Z0-9+.-]*://', ''),
                       '[/?#].*$', ''),
                     '^www\.', ''),
                   '') AS host
          FROM win
        ) hosts
        GROUP BY host
        ORDER BY count(*) DESC
        LIMIT greatest(p_limit, 1)
      ) s
    ), '[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_traffic_daily(days integer DEFAULT 30)
 RETURNS TABLE(day date, views bigint, visitors bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;
  RETURN QUERY
    SELECT (pv.created_at AT TIME ZONE 'utc')::date AS day,
           count(*)::bigint AS views,
           count(DISTINCT pv.visitor_id)::bigint AS visitors
      FROM public.page_views pv
     WHERE pv.created_at >= now() - make_interval(days => admin_traffic_daily.days)
     GROUP BY 1
     ORDER BY 1;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_user_auth_activity(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, last_sign_in_at timestamp with time zone, active_sessions integer, last_session_started_at timestamp with time zone, last_session_active_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    u.id as user_id,
    u.last_sign_in_at,
    (
      select count(*)::integer
      from auth.sessions s
      where s.user_id = u.id
        and (s.not_after is null or s.not_after > now())
    ) as active_sessions,
    latest.created_at as last_session_started_at,
    latest.active_at as last_session_active_at
  from auth.users u
  left join lateral (
    select
      s.created_at,
      greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'UTC') as active_at
    from auth.sessions s
    where s.user_id = u.id
    order by s.created_at desc
    limit 1
  ) latest on true
  where u.id = any(p_user_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.api_rate_check(p_user_id uuid, p_window_seconds integer, p_max integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.api_rate_check(p_user_id, p_window_seconds, p_max, 'legacy');
$function$
;

CREATE OR REPLACE FUNCTION public.api_rate_check(p_user_id uuid, p_window_seconds integer, p_max integer, p_scope text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE used int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_scope, 0));
  DELETE FROM public.api_rate_hits
   WHERE user_id = p_user_id AND scope = p_scope
     AND created_at < now() - make_interval(secs => p_window_seconds * 4);
  SELECT count(*) INTO used FROM public.api_rate_hits
   WHERE user_id = p_user_id AND scope = p_scope
     AND created_at >= now() - make_interval(secs => p_window_seconds);
  IF used >= p_max THEN RETURN false; END IF;
  INSERT INTO public.api_rate_hits (user_id, scope) VALUES (p_user_id, p_scope);
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.auth_email_status(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_confirmed timestamptz;
  v_found boolean := false;
begin
  select u.email_confirmed_at, true
    into v_confirmed, v_found
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at asc
  limit 1;

  if not coalesce(v_found, false) then
    return 'none';
  elsif v_confirmed is not null then
    return 'confirmed';
  else
    return 'unconfirmed';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.blast_recipient_emails(p_user_ids uuid[])
 RETURNS TABLE(id uuid, email text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id, u.email::text
    from auth.users u
   where u.id = any(p_user_ids)
     and u.email_confirmed_at is not null
     and u.email is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_job_advance(p_generation_id uuid, p_provider_request_id text, p_lease_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE affected int;
BEGIN
  -- Serialize every claim for one generation so the conditional update below
  -- cannot be passed by two callers at once.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_generation_id::text, 11));

  UPDATE public.generation_jobs
     SET advance_lock = gen_random_uuid(),
         advance_locked_at = now()
   WHERE generation_id = p_generation_id
     -- Only the exact provider job the caller observed. Once a winner advances
     -- the row to the next stage its provider_request_id changes, so a stale
     -- caller keyed to the old id claims nothing. NOT DISTINCT FROM so NULL
     -- matches NULL rather than never matching.
     AND provider_request_id IS NOT DISTINCT FROM p_provider_request_id
     -- Free, or the previous holder's lease expired (it crashed mid-advance).
     AND (advance_lock IS NULL
          OR advance_locked_at < now() - make_interval(secs => p_lease_seconds));

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END $function$
;

CREATE OR REPLACE FUNCTION public.clawback_credit_purchase(p_purchase_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_credits int;
BEGIN
  UPDATE public.credit_purchases SET refunded_at = now()
   WHERE id = p_purchase_id AND refunded_at IS NULL
   RETURNING user_id, credits INTO v_user_id, v_credits;
  IF v_user_id IS NULL THEN
    RETURN false;  -- already clawed back (or no such purchase)
  END IF;
  UPDATE public.profiles
     SET purchased_credits = greatest(0, coalesce(purchased_credits, 0) - v_credits)
   WHERE id = v_user_id;
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.community_hearts_bump()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_posts SET hearts_count = hearts_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSE
    UPDATE public.community_posts SET hearts_count = greatest(0, hearts_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.create_api_key_capped(p_user_id uuid, p_max integer, p_name text, p_prefix text, p_key_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE active int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 41));
  SELECT count(*) INTO active FROM public.api_keys
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  IF active >= p_max THEN RETURN false; END IF;
  INSERT INTO public.api_keys (user_id, name, prefix, key_hash)
  VALUES (p_user_id, p_name, p_prefix, p_key_hash);
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.decrement_purchased_credits(p_user_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.profiles
     set purchased_credits = greatest(0, coalesce(purchased_credits,0) - p_amount)
   where id = p_user_id and p_amount > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.drip_candidates()
 RETURNS TABLE(user_id uuid, email text, username text, full_name text, template text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH confirmed AS (
    SELECT u.id, u.email::text AS email, p.username, p.full_name, p.created_at, p.plan
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE u.email_confirmed_at IS NOT NULL
       AND COALESCE(p.marketing_opt_out, false) = false
       AND COALESCE(p.status, 'active') <> 'suspended'
  )
  SELECT c.id, c.email, c.username, c.full_name, 'drip_day1'
    FROM confirmed c
   WHERE c.created_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM public.generations g WHERE g.user_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.drip_sends d WHERE d.user_id = c.id AND d.template = 'drip_day1')
  UNION ALL
  SELECT c.id, c.email, c.username, c.full_name, 'drip_day3'
    FROM confirmed c
   WHERE c.created_at BETWEEN now() - interval '96 hours' AND now() - interval '72 hours'
     AND NOT EXISTS (SELECT 1 FROM public.drip_sends d WHERE d.user_id = c.id AND d.template = 'drip_day3')
  UNION ALL
  SELECT c.id, c.email, c.username, c.full_name, 'drip_day7'
    FROM confirmed c
   WHERE c.created_at BETWEEN now() - interval '192 hours' AND now() - interval '168 hours'
     AND c.plan = 'none'
     AND NOT EXISTS (SELECT 1 FROM public.drip_sends d WHERE d.user_id = c.id AND d.template = 'drip_day7')
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_reference_paths_owned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reference_image_urls IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.reference_image_urls) u
    WHERE u IS NULL OR position((NEW.user_id::text || '/') in u) <> 1
  ) THEN
    RAISE EXCEPTION 'reference_image_urls must all be under the owner''s storage folder';
  END IF;
  IF NEW.outfit_image_urls IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.outfit_image_urls) u
    WHERE u IS NULL OR position((NEW.user_id::text || '/') in u) <> 1
  ) THEN
    RAISE EXCEPTION 'outfit_image_urls must all be under the owner''s storage folder';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base text;
  candidate text;
  attempt int := 0;
begin
  base := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '_', 'g');

  if length(base) < 3 then
    base := base || '_' || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;

  if length(base) > 19 then
    base := substr(base, 1, 19);
  end if;

  candidate := base;
  loop
    begin
      insert into public.profiles (id, email, username)
      values (new.id, new.email, candidate);
      return new;
    exception
      when unique_violation then
        if exists (select 1 from public.profiles where id = new.id) then
          raise;
        end if;
        attempt := attempt + 1;
        if attempt > 6 then
          raise;
        elsif attempt > 5 then
          candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
        else
          candidate := base || '_' || (floor(random() * 9000) + 1000)::int;
        end if;
    end;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_free_generations(p_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.profiles
     set free_generations_used = coalesce(free_generations_used,0) + 1
   where id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.insert_brand_rules_capped(p_user_id uuid, p_cap integer, p_rules jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE existing int; n int; elem jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 37));
  SELECT count(*) INTO existing FROM public.brand_rules WHERE user_id = p_user_id;
  n := coalesce(jsonb_array_length(p_rules), 0);
  IF n = 0 THEN RETURN 0; END IF;
  IF existing + n > p_cap THEN RETURN -1; END IF;
  FOR elem IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
    INSERT INTO public.brand_rules (user_id, kind, label, value, applies_to, severity)
    VALUES (p_user_id, elem->>'kind', elem->>'label', elem->>'value',
            elem->>'applies_to', elem->>'severity');
  END LOOP;
  RETURN n;
END $function$
;

CREATE OR REPLACE FUNCTION public.insert_saved_prompt_capped(p_user_id uuid, p_cap integer, p_prompt text, p_source_input text, p_character_profile_id uuid, p_content_type text, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE used int; rec record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 31));
  SELECT count(*) INTO used FROM public.saved_prompts WHERE user_id = p_user_id;
  IF used >= p_cap THEN RETURN NULL; END IF;
  INSERT INTO public.saved_prompts
    (user_id, prompt, source_input, character_profile_id, content_type, source)
  VALUES
    (p_user_id, p_prompt, p_source_input, p_character_profile_id, p_content_type, p_source)
  RETURNING id, prompt, source_input, character_profile_id, content_type, source, created_at
    INTO rec;
  RETURN to_jsonb(rec);
END $function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.monthly_credits_used(p_user_id uuid, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    sum(CASE WHEN credits_used IS NULL THEN 1 ELSE credits_used END),
    0
  )::int
  FROM public.generations
  WHERE user_id = p_user_id AND created_at >= p_since;
$function$
;

CREATE OR REPLACE FUNCTION public.record_agent_units(p_user_id uuid, p_since timestamp with time zone, p_cap integer, p_units integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  used int;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 91));
  select coalesce(sum(units), 0)::int into used
    from public.agent_usage
   where user_id = p_user_id and created_at >= p_since;
  if used + p_units > p_cap then
    return null;
  end if;
  -- Reserved at the worst case the mode can cost. If the process dies
  -- between here and the route's update, the row STAYS at the reservation:
  -- the user is charged rather than refunded, which is the safe direction
  -- for an endpoint that has already spent someone else's tokens.
  insert into public.agent_usage (user_id, mode, units)
  values (p_user_id, 'reserved', p_units)
  returning id into new_id;
  return new_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_community_hide()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.hidden_at IS NOT NULL AND OLD.hidden_at IS NULL THEN
    INSERT INTO public.community_moderation (generation_id, hidden_by)
    VALUES (NEW.generation_id, auth.uid())
    ON CONFLICT (generation_id) DO NOTHING;
  END IF;
  IF NEW.hidden_at IS NULL AND OLD.hidden_at IS NOT NULL THEN
    DELETE FROM public.community_moderation WHERE generation_id = NEW.generation_id;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.record_community_view(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.community_views (post_id, user_id)
  VALUES (p_post_id, auth.uid())
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    UPDATE public.community_posts SET views_count = views_count + 1 WHERE id = p_post_id;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.record_credit_purchase(p_user_id uuid, p_session_id text, p_amount_cents integer, p_currency text, p_credits integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  insert into public.credit_purchases (user_id, credits, amount_cents, currency, stripe_session_id)
  values (p_user_id, p_credits, p_amount_cents, p_currency, p_session_id)
  on conflict (stripe_session_id) do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    update public.profiles set purchased_credits = coalesce(purchased_credits,0) + p_credits where id = p_user_id;
    return true;
  end if;
  return false;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_model_failure(p_model_id text, p_kind text, p_error text, p_user_id uuid, p_failure_threshold integer, p_min_distinct_users integer, p_base_cooldown_ms bigint, p_max_cooldown_ms bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_failures int;
  v_trip_count int;
  v_users uuid[];
  v_should_trip boolean;
  v_cooldown_ms bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('model_health:' || p_model_id, 29));

  INSERT INTO public.model_health (model_id, kind, consecutive_failures, failing_user_ids, trip_count, updated_at)
  VALUES (p_model_id, p_kind, 0, '{}', 0, now())
  ON CONFLICT (model_id) DO NOTHING;

  SELECT coalesce(consecutive_failures, 0) + 1,
         coalesce(trip_count, 0),
         (SELECT coalesce(array_agg(DISTINCT u), '{}')
            FROM unnest(
              coalesce(failing_user_ids, '{}')
              || CASE WHEN p_user_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_user_id] END
            ) AS u)
    INTO v_failures, v_trip_count, v_users
    FROM public.model_health
   WHERE model_id = p_model_id
   FOR UPDATE;

  v_should_trip := v_failures >= p_failure_threshold
               AND coalesce(array_length(v_users, 1), 0) >= p_min_distinct_users;
  IF v_should_trip THEN
    v_trip_count := v_trip_count + 1;
  END IF;
  v_cooldown_ms := least(
    (p_base_cooldown_ms * (2 ^ greatest(0, v_trip_count - 1))::numeric)::bigint,
    p_max_cooldown_ms
  );

  UPDATE public.model_health
     SET kind = p_kind,
         consecutive_failures = v_failures,
         failing_user_ids = v_users,
         last_error = left(p_error, 500),
         last_failure_at = now(),
         updated_at = now(),
         tripped_at = CASE WHEN v_should_trip THEN now() ELSE tripped_at END,
         retry_after = CASE WHEN v_should_trip
                            THEN now() + make_interval(secs => v_cooldown_ms / 1000.0)
                            ELSE retry_after END,
         trip_count = CASE WHEN v_should_trip THEN v_trip_count ELSE trip_count END
   WHERE model_id = p_model_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.record_prompt_assist(p_user_id uuid, p_since timestamp with time zone, p_cap integer, p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare used int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7));
  select count(*) into used from public.prompt_assists
   where user_id = p_user_id and (p_since is null or created_at >= p_since);
  if p_cap >= 0 and used >= p_cap then
    return -1;
  end if;
  insert into public.prompt_assists (user_id, kind) values (p_user_id, p_kind);
  if p_cap < 0 then return 2147483647; end if;
  return greatest(0, p_cap - used - 1);
end $function$
;

CREATE OR REPLACE FUNCTION public.record_user_activity(p_idle_gap_seconds integer DEFAULT 300, p_max_credit_seconds integer DEFAULT 120)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_gap numeric;
  v_credit integer;
begin
  if v_uid is null then
    return;
  end if;

  select p.last_seen_at into v_last
  from public.profiles p
  where p.id = v_uid
  for update;

  v_gap := case when v_last is null then null else extract(epoch from (now() - v_last)) end;

  if v_gap is null or v_gap > p_idle_gap_seconds or v_gap < 0 then
    -- First heartbeat, or back after being away: start a fresh visit.
    update public.profiles
       set session_started_at = now(),
           session_seconds = 0,
           last_seen_at = now()
     where id = v_uid;
  else
    v_credit := least(v_gap, p_max_credit_seconds)::integer;
    update public.profiles
       set session_seconds = session_seconds + v_credit,
           total_active_seconds = total_active_seconds + v_credit,
           session_started_at = coalesce(session_started_at, now()),
           last_seen_at = now()
     where id = v_uid;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_daily_free_generation(p_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.profiles SET free_generation_last_at = NULL
   WHERE id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_free_reference_generation(p_user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.profiles
     SET free_reference_generations_used = greatest(0, coalesce(free_reference_generations_used,0) - 1)
   WHERE id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.report_community_post(p_post_id uuid, p_reason text, p_details text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE gid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;
  IF p_reason NOT IN ('wrong_result', 'inappropriate', 'technical_error', 'other') THEN
    RAISE EXCEPTION 'Pick a reason for the report.';
  END IF;
  SELECT generation_id INTO gid FROM public.community_posts WHERE id = p_post_id;
  IF gid IS NULL THEN RAISE EXCEPTION 'Post not found.'; END IF;

  IF (SELECT count(*)
        FROM public.generation_reports
       WHERE user_id = auth.uid()
         AND created_at > now() - interval '1 minute') >= 10 THEN
    RAISE EXCEPTION 'You''re reporting quickly — give it a moment.';
  END IF;

  IF EXISTS (SELECT 1
               FROM public.generation_reports
              WHERE generation_id = gid
                AND user_id = auth.uid()
                AND source = 'community'
                AND created_at > now() - interval '24 hours') THEN
    RETURN;
  END IF;

  INSERT INTO public.generation_reports (generation_id, user_id, reason, details, source)
  VALUES (gid, auth.uid(), p_reason, left(coalesce(p_details, ''), 1000), 'community');
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_generation(p_user_id uuid, p_monthly_portion integer, p_limit integer, p_since timestamp with time zone, p_row jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  used int;
  rec public.generations;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 23));

  SELECT coalesce(sum(CASE WHEN credits_used IS NULL THEN 1 ELSE credits_used END), 0)::int
    INTO used
    FROM public.generations
   WHERE user_id = p_user_id AND created_at >= p_since;

  IF p_monthly_portion > GREATEST(0, p_limit - used) THEN
    RETURN NULL;
  END IF;

  rec := jsonb_populate_record(NULL::public.generations, p_row);
  -- Force ownership from the trusted argument, never from the client-built row.
  rec.user_id := p_user_id;
  -- Fill NOT NULL columns the caller may have omitted with their table defaults.
  rec.id := coalesce(rec.id, gen_random_uuid());
  rec.created_at := coalesce(rec.created_at, now());
  rec.updated_at := coalesce(rec.updated_at, now());
  rec.status := coalesce(rec.status, 'generating');
  rec.attempts := coalesce(rec.attempts, 0);
  rec.pipeline_log := coalesce(rec.pipeline_log, '[]'::jsonb);
  rec.content_type := coalesce(rec.content_type, 'video');
  rec.cancel_requested := coalesce(rec.cancel_requested, false);
  rec.credits_used := coalesce(rec.credits_used, 0);
  rec.character_profile_ids := coalesce(rec.character_profile_ids, '{}'::uuid[]);
  rec.purchased_credits_used := coalesce(rec.purchased_credits_used, 0);
  rec.free_generation_used := coalesce(rec.free_generation_used, false);

  INSERT INTO public.generations VALUES (rec.*);
  RETURN rec.id;
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_generations(p_user_id uuid, p_monthly_portion integer, p_limit integer, p_since timestamp with time zone, p_rows jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  used int;
  rec public.generations;
  elem jsonb;
  ids uuid[] := '{}';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 23));

  SELECT coalesce(sum(CASE WHEN credits_used IS NULL THEN 1 ELSE credits_used END), 0)::int
    INTO used
    FROM public.generations
   WHERE user_id = p_user_id AND created_at >= p_since;

  IF p_monthly_portion > GREATEST(0, p_limit - used) THEN
    RETURN NULL;
  END IF;

  FOR elem IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    rec := jsonb_populate_record(NULL::public.generations, elem);
    rec.user_id := p_user_id;
    rec.id := coalesce(rec.id, gen_random_uuid());
    rec.created_at := coalesce(rec.created_at, now());
    rec.updated_at := coalesce(rec.updated_at, now());
    rec.status := coalesce(rec.status, 'generating');
    rec.attempts := coalesce(rec.attempts, 0);
    rec.pipeline_log := coalesce(rec.pipeline_log, '[]'::jsonb);
    rec.content_type := coalesce(rec.content_type, 'video');
    rec.cancel_requested := coalesce(rec.cancel_requested, false);
    rec.credits_used := coalesce(rec.credits_used, 0);
    rec.character_profile_ids := coalesce(rec.character_profile_ids, '{}'::uuid[]);
    rec.purchased_credits_used := coalesce(rec.purchased_credits_used, 0);
    rec.free_generation_used := coalesce(rec.free_generation_used, false);
    INSERT INTO public.generations VALUES (rec.*);
    ids := array_append(ids, rec.id);
  END LOOP;

  RETURN ids;
END $function$
;

CREATE OR REPLACE FUNCTION public.reserve_reference_image_generation(p_user_id uuid, p_cap integer, p_since timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE used int; new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 29));
  SELECT count(*) INTO used FROM public.reference_image_generations
   WHERE user_id = p_user_id AND created_at >= p_since;
  IF used >= p_cap THEN RETURN NULL; END IF;
  INSERT INTO public.reference_image_generations (user_id) VALUES (p_user_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.reward_referral_on_success()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_referred_by uuid;
  v_rewarded_at timestamptz;
  v_rewards_this_month int;
begin
  if new.status <> 'succeeded' then
    return new;
  end if;

  begin
    select referred_by, referral_rewarded_at
      into v_referred_by, v_rewarded_at
      from public.profiles
     where id = new.user_id
       for update;

    if v_referred_by is null or v_rewarded_at is not null then
      return new;
    end if;

    -- Mark first, then pay via the same atomic add the store uses.
    update public.profiles
       set referral_rewarded_at = now()
     where id = new.user_id;
    perform public.add_purchased_credits(new.user_id, 1);

    -- Serialise concurrent rewards against the same referrer before the
    -- count below — without this the ceiling was advisory under load.
    perform 1 from public.profiles where id = v_referred_by for update;

    select count(*)
      into v_rewards_this_month
      from public.profiles
     where referred_by = v_referred_by
       and referral_rewarded_at >= date_trunc('month', now())
       and id <> new.user_id;

    if v_rewards_this_month < 20 then
      perform public.add_purchased_credits(v_referred_by, 1);
    end if;
  exception when others then
    raise warning 'reward_referral_on_success skipped for generation %: % (%)',
      new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.share_to_community(p_generation_id uuid, p_caption text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  post_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;

  IF EXISTS (SELECT 1 FROM public.community_moderation WHERE generation_id = p_generation_id) THEN
    RAISE EXCEPTION 'This post was removed by moderation and can''t be shared again.';
  END IF;

  SELECT gen.id, gen.result_url, gen.content_type, gen.prompt_input, gen.status, gen.deleted_at,
         gen.match_score, ch.name AS character_name,
         p.username
    INTO g
    FROM public.generations gen
    JOIN public.profiles p ON p.id = gen.user_id
    LEFT JOIN public.character_profiles ch ON ch.id = gen.character_profile_id
   WHERE gen.id = p_generation_id AND gen.user_id = auth.uid();

  IF g.id IS NULL THEN RAISE EXCEPTION 'Couldn''t find that generation.'; END IF;
  IF g.status <> 'succeeded' OR g.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only finished renders can be shared.';
  END IF;
  IF g.result_url IS NULL OR (g.result_url NOT LIKE 'http%' AND g.result_url NOT LIKE '/api/media/%') THEN
    RAISE EXCEPTION 'This render has no shareable media.';
  END IF;

  INSERT INTO public.community_posts
    (generation_id, user_id, username, caption, media_url, content_type, prompt, match_score, character_name)
  VALUES (
    g.id, auth.uid(), g.username,
    nullif(left(trim(coalesce(p_caption, '')), 200), ''),
    g.result_url,
    CASE WHEN g.content_type = 'video' THEN 'video' ELSE 'image' END,
    left(g.prompt_input, 300),
    g.match_score,
    left(g.character_name, 80)
  )
  ON CONFLICT (generation_id) DO NOTHING
  RETURNING id INTO post_id;

  IF post_id IS NULL THEN
    SELECT id INTO post_id FROM public.community_posts WHERE generation_id = g.id;
  END IF;
  RETURN post_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.spend_daily_free_generation(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE updated int;
BEGIN
  UPDATE public.profiles SET free_generation_last_at = now()
   WHERE id = p_user_id
     AND (free_generation_last_at IS NULL
          OR free_generation_last_at < date_trunc('day', now()));
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $function$
;

CREATE OR REPLACE FUNCTION public.spend_free_generation(p_user_id uuid, p_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare updated int;
begin
  update public.profiles
     set free_generations_used = coalesce(free_generations_used,0) + 1
   where id = p_user_id and coalesce(free_generations_used,0) < p_limit;
  get diagnostics updated = row_count;
  return updated > 0;
end $function$
;

CREATE OR REPLACE FUNCTION public.spend_free_reference_generation(p_user_id uuid, p_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE updated int;
BEGIN
  UPDATE public.profiles
     SET free_reference_generations_used = coalesce(free_reference_generations_used,0) + 1
   WHERE id = p_user_id AND coalesce(free_reference_generations_used,0) < p_limit;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $function$
;

CREATE OR REPLACE FUNCTION public.spend_purchased_credits(p_user_id uuid, p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare updated int;
begin
  if p_amount is null or p_amount <= 0 then return true; end if;
  update public.profiles
     set purchased_credits = purchased_credits - p_amount
   where id = p_user_id and coalesce(purchased_credits,0) >= p_amount;
  get diagnostics updated = row_count;
  return updated > 0;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_profile_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.user_reliability_stats(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', count(*),
    'first_try', count(*) FILTER (WHERE attempts = 1 AND status = 'succeeded'),
    'attempts_sum', coalesce(sum(attempts), 0)
  )
  FROM public.generations
  WHERE user_id = p_user_id AND status IN ('succeeded','failed');
$function$
;

CREATE OR REPLACE FUNCTION public.username_available(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_username ~ '^[a-z0-9_]{3,24}$'
     and not exists (
       select 1 from public.profiles where lower(username) = lower(p_username)
     );
$function$
;

CREATE TRIGGER trg_enforce_reference_paths_owned BEFORE INSERT OR UPDATE ON character_profiles FOR EACH ROW EXECUTE FUNCTION enforce_reference_paths_owned();
CREATE TRIGGER community_hearts_bump_trigger AFTER INSERT OR DELETE ON community_hearts FOR EACH ROW EXECUTE FUNCTION community_hearts_bump();
CREATE TRIGGER community_hide_ledger AFTER UPDATE OF hidden_at ON community_posts FOR EACH ROW EXECUTE FUNCTION record_community_hide();
CREATE TRIGGER reward_referral_on_success AFTER INSERT OR UPDATE OF status ON generations FOR EACH ROW EXECUTE FUNCTION reward_referral_on_success();

create policy "Admins manage their own push subscriptions" on public.admin_push_subscriptions for all to public
  using (((auth.uid() = user_id) AND is_admin()))
  with check (((auth.uid() = user_id) AND is_admin()));
create policy "Admins read all agent usage" on public.agent_usage for select to public
  using (is_admin());
create policy "Users read their own agent usage" on public.agent_usage for select to public
  using ((auth.uid() = user_id));
create policy "Admins can view all api keys" on public.api_keys for select to public
  using (is_admin());
create policy "Insert own api keys" on public.api_keys for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own api keys or admin reads all" on public.api_keys for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own api keys" on public.api_keys for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Admins can update app settings" on public.app_settings for update to public
  using (( SELECT is_admin() AS is_admin));
create policy "Authenticated users can read app settings" on public.app_settings for select to authenticated
  using (true);
create policy "Delete own brand rules" on public.brand_rules for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own brand rules" on public.brand_rules for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own brand rules or admin reads all" on public.brand_rules for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own brand rules" on public.brand_rules for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Delete own character profiles" on public.character_profiles for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own character profiles" on public.character_profiles for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own character profiles or admin reads all" on public.character_profiles for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own character profiles" on public.character_profiles for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users manage their own hearts" on public.community_hearts for all to authenticated
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "Admins read moderation" on public.community_moderation for select to authenticated
  using (is_admin());
create policy "Admins moderate posts" on public.community_posts for update to authenticated
  using (is_admin())
  with check (is_admin());
create policy "Signed-in users see visible posts" on public.community_posts for select to authenticated
  using (((hidden_at IS NULL) OR (auth.uid() = user_id) OR is_admin()));
create policy "Users unshare their own posts" on public.community_posts for delete to authenticated
  using (((auth.uid() = user_id) AND (hidden_at IS NULL)));
create policy "Admins can view all credit purchases" on public.credit_purchases for select to public
  using (is_admin());
create policy "Read own credit purchases or admin reads all" on public.credit_purchases for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Admins can view all drip sends" on public.drip_sends for select to public
  using (is_admin());
create policy "Admins can insert feature flags" on public.feature_flags for insert to public
  with check (( SELECT is_admin() AS is_admin));
create policy "Admins can update feature flags" on public.feature_flags for update to public
  using (( SELECT is_admin() AS is_admin));
create policy "Anyone can check if signups are open" on public.feature_flags for select to anon
  using ((key = 'signups_enabled'::text));
create policy "Authenticated users can read feature flags" on public.feature_flags for select to authenticated
  using (true);
create policy "Admins can update feedback" on public.feedback for update to public
  using (( SELECT is_admin() AS is_admin));
create policy "Insert own feedback" on public.feedback for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own feedback or admin reads all" on public.feedback for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "layers read own" on public.generation_layers for select to authenticated
  using ((user_id = auth.uid()));
create policy "Admins can update generation reports" on public.generation_reports for update to public
  using (( SELECT is_admin() AS is_admin));
create policy "Admins can view all generation reports" on public.generation_reports for select to public
  using (is_admin());
create policy "Insert own generation reports" on public.generation_reports for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own generation reports or admin reads all" on public.generation_reports for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "signals read own" on public.generation_signals for select to authenticated
  using ((user_id = auth.uid()));
create policy "Delete own generations" on public.generations for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own generations" on public.generations for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own generations or admin reads all" on public.generations for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own generations" on public.generations for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Admins can view all model health" on public.model_health for select to public
  using (is_admin());
create policy "Delete own notes" on public.notes for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own notes" on public.notes for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own notes or admin reads all" on public.notes for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own notes" on public.notes for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Admins can view page views" on public.page_views for select to public
  using (( SELECT is_admin() AS is_admin));
create policy "Anyone can log a page view" on public.page_views for insert to anon,authenticated
  with check (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid))));
create policy "Admins can view all products" on public.products for select to public
  using (is_admin());
create policy "Users manage their own products" on public.products for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));
create policy "Read own profile or admin reads all" on public.profiles for select to public
  using (((( SELECT auth.uid() AS uid) = id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own profile or admin updates all" on public.profiles for update to public
  using (((( SELECT auth.uid() AS uid) = id) OR ( SELECT is_admin() AS is_admin)))
  with check (((( SELECT auth.uid() AS uid) = id) OR ( SELECT is_admin() AS is_admin)));
create policy "Delete own projects" on public.projects for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own projects" on public.projects for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own projects or admin reads all" on public.projects for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Update own projects" on public.projects for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Admins manage promo codes" on public.promo_codes for all to public
  using (( SELECT is_admin() AS is_admin))
  with check (( SELECT is_admin() AS is_admin));
create policy "Admins can view all promo redemptions" on public.promo_redemptions for select to public
  using (is_admin());
create policy "Admins read redemptions" on public.promo_redemptions for select to public
  using (( SELECT is_admin() AS is_admin));
create policy "Insert own prompt assists" on public.prompt_assists for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own prompt assists or admin reads all" on public.prompt_assists for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Users manage their own push tokens" on public.push_tokens for all to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own reference image generations" on public.reference_image_generations for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own reference image generations or admin reads all" on public.reference_image_generations for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT is_admin() AS is_admin)));
create policy "Delete own saved prompts" on public.saved_prompts for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Insert own saved prompts" on public.saved_prompts for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Read own saved prompts" on public.saved_prompts for select to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "Update own saved prompts" on public.saved_prompts for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "reels read own" on public.user_reels for select to authenticated
  using ((user_id = auth.uid()));
create policy "Admins can delete voice presets" on public.voice_presets for delete to public
  using (( SELECT is_admin() AS is_admin));
create policy "Admins can insert voice presets" on public.voice_presets for insert to public
  with check (( SELECT is_admin() AS is_admin));
create policy "Admins can update voice presets" on public.voice_presets for update to public
  using (( SELECT is_admin() AS is_admin));
create policy "Authenticated users can read voice presets" on public.voice_presets for select to authenticated
  using (true);

grant delete, insert, references, select, trigger, truncate, update on public.admin_push_subscriptions to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.admin_push_subscriptions to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.agent_usage to anon;
grant delete, insert, references, select, trigger, truncate, update on public.agent_usage to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.agent_usage to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.api_keys to anon;
grant delete, insert, references, select, trigger, truncate, update on public.api_keys to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.api_keys to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.api_rate_hits to anon;
grant delete, insert, references, select, trigger, truncate, update on public.api_rate_hits to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.api_rate_hits to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.app_settings to anon;
grant delete, insert, references, select, trigger, truncate, update on public.app_settings to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.app_settings to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.brand_rules to anon;
grant delete, insert, references, select, trigger, truncate, update on public.brand_rules to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.brand_rules to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.character_profiles to anon;
grant delete, insert, references, select, trigger, truncate, update on public.character_profiles to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.character_profiles to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.character_profiles_backup_20260814 to anon;
grant delete, insert, references, select, trigger, truncate, update on public.character_profiles_backup_20260814 to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.character_profiles_backup_20260814 to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.community_hearts to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.community_hearts to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.community_moderation to anon;
grant delete, insert, references, select, trigger, truncate, update on public.community_moderation to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.community_moderation to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.community_posts to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.community_posts to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.community_views to service_role;
grant references, select, trigger, truncate on public.credit_purchases to anon;
grant references, select, trigger, truncate on public.credit_purchases to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.credit_purchases to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.drip_sends to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.email_sends to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.email_templates to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.feature_flags to anon;
grant delete, insert, references, select, trigger, truncate, update on public.feature_flags to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.feature_flags to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.feedback to anon;
grant delete, insert, references, select, trigger, truncate, update on public.feedback to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.feedback to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.generation_jobs to anon;
grant delete, insert, references, select, trigger, truncate, update on public.generation_jobs to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.generation_jobs to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.generation_layers to anon;
grant delete, insert, references, select, trigger, truncate, update on public.generation_layers to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.generation_layers to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.generation_reports to anon;
grant delete, insert, references, select, trigger, truncate, update on public.generation_reports to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.generation_reports to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.generation_signals to anon;
grant delete, insert, references, select, trigger, truncate, update on public.generation_signals to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.generation_signals to service_role;
grant references, select, trigger, truncate on public.generations to anon;
grant references, select, trigger, truncate on public.generations to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.generations to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.model_health to anon;
grant delete, insert, references, select, trigger, truncate, update on public.model_health to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.model_health to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.notes to anon;
grant delete, insert, references, select, trigger, truncate, update on public.notes to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.notes to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.page_views to anon;
grant delete, insert, references, select, trigger, truncate, update on public.page_views to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.page_views to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.products to anon;
grant delete, insert, references, select, trigger, truncate, update on public.products to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.products to service_role;
grant references, select, trigger, truncate on public.profiles to anon;
grant delete, insert, references, select, trigger, truncate on public.profiles to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.profiles to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.projects to anon;
grant delete, insert, references, select, trigger, truncate, update on public.projects to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.projects to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.promo_codes to anon;
grant delete, insert, references, select, trigger, truncate, update on public.promo_codes to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.promo_codes to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.promo_redemptions to anon;
grant delete, insert, references, select, trigger, truncate, update on public.promo_redemptions to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.promo_redemptions to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.prompt_assists to anon;
grant delete, insert, references, select, trigger, truncate, update on public.prompt_assists to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.prompt_assists to service_role;
grant delete, references, select, trigger, truncate on public.push_tokens to anon;
grant delete, references, select, trigger, truncate on public.push_tokens to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.push_tokens to service_role;
grant references, select, trigger, truncate on public.reference_image_generations to anon;
grant references, select, trigger, truncate on public.reference_image_generations to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.reference_image_generations to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.saved_prompts to anon;
grant delete, insert, references, select, trigger, truncate, update on public.saved_prompts to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.saved_prompts to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.user_reels to anon;
grant delete, insert, references, select, trigger, truncate, update on public.user_reels to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.user_reels to service_role;
grant delete, insert, references, select, trigger, truncate, update on public.voice_presets to anon;
grant delete, insert, references, select, trigger, truncate, update on public.voice_presets to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.voice_presets to service_role;
