--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_calls (
    id bigint NOT NULL,
    agent_key text,
    user_id text,
    provider text DEFAULT ''::text,
    ok boolean DEFAULT true,
    latency_ms integer DEFAULT 0,
    cost_credits integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_calls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_calls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_calls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_calls_id_seq OWNED BY public.agent_calls.id;


--
-- Name: agent_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_providers (
    id text NOT NULL,
    agent_key text NOT NULL,
    provider text DEFAULT ''::text,
    model text DEFAULT ''::text,
    weight integer DEFAULT 1,
    priority integer DEFAULT 10,
    cost_per_call integer DEFAULT 0,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_rule_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_rule_logs (
    id bigint NOT NULL,
    rule_id text,
    fired_at timestamp with time zone DEFAULT now(),
    result jsonb DEFAULT '{}'::jsonb
);


--
-- Name: agent_rule_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_rule_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_rule_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_rule_logs_id_seq OWNED BY public.agent_rule_logs.id;


--
-- Name: agent_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_rules (
    id text NOT NULL,
    name text NOT NULL,
    trigger text DEFAULT ''::text,
    condition jsonb DEFAULT '{}'::jsonb,
    action jsonb DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    key text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true,
    daily_budget integer DEFAULT 0,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    agent_type text DEFAULT 'model'::text,
    skill_key text DEFAULT ''::text
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    actor_id text,
    action text,
    target text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id text NOT NULL,
    name text NOT NULL,
    avatar_url text DEFAULT ''::text,
    gender text DEFAULT ''::text,
    age integer DEFAULT 0,
    tags text[] DEFAULT '{}'::text[],
    style jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    description text DEFAULT ''::text,
    reference_images text[] DEFAULT '{}'::text[],
    base_model text DEFAULT ''::text,
    source text DEFAULT 'user'::text
);


--
-- Name: consumption_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumption_ledger (
    id bigint NOT NULL,
    scope text DEFAULT 'user'::text NOT NULL,
    actor_id text DEFAULT ''::text,
    purpose text NOT NULL,
    provider_id text DEFAULT ''::text,
    model_id text DEFAULT ''::text,
    model_type text DEFAULT ''::text,
    input_units integer DEFAULT 0,
    output_units integer DEFAULT 0,
    backend_cost_cents numeric DEFAULT 0,
    customer_charge_credits integer DEFAULT 0,
    customer_charge_cents numeric DEFAULT 0,
    margin_cents numeric DEFAULT 0,
    task_ref text DEFAULT ''::text,
    idempotency_key text DEFAULT ''::text,
    status text DEFAULT 'ok'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: consumption_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consumption_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: consumption_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consumption_ledger_id_seq OWNED BY public.consumption_ledger.id;


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id bigint NOT NULL,
    code character varying(32) NOT NULL,
    type character varying(16) NOT NULL,
    value integer NOT NULL,
    min_spend integer DEFAULT 0 NOT NULL,
    expire_at timestamp with time zone
);


--
-- Name: coupons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coupons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupons_id_seq OWNED BY public.coupons.id;


--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_transactions (
    id bigint NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    amount integer NOT NULL,
    ref text,
    balance_after integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pool text
);


--
-- Name: credit_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credit_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credit_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credit_transactions_id_seq OWNED BY public.credit_transactions.id;


--
-- Name: cron_marker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cron_marker (
    name text NOT NULL,
    last_run timestamp with time zone,
    cursor jsonb DEFAULT '{}'::jsonb
);


--
-- Name: default_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.default_assets (
    id text NOT NULL,
    key text NOT NULL,
    title text DEFAULT ''::text,
    type text DEFAULT 'image'::text,
    thumbnail text DEFAULT ''::text,
    full_url text DEFAULT ''::text,
    prompt text DEFAULT ''::text,
    model text DEFAULT ''::text,
    ratio text DEFAULT '1:1'::text,
    source text DEFAULT 'default'::text,
    category text DEFAULT 'generated'::text,
    status text DEFAULT 'success'::text,
    sort integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    tags jsonb DEFAULT '[]'::jsonb
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id text NOT NULL,
    user_id text,
    type text DEFAULT 'other'::text,
    title text DEFAULT ''::text,
    content text DEFAULT ''::text,
    contact text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: generation_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_tasks (
    task_id text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    model text DEFAULT ''::text,
    prompt text DEFAULT ''::text,
    count integer DEFAULT 1,
    content_type text DEFAULT 'image'::text,
    result jsonb,
    error text DEFAULT ''::text,
    pending_ids text[] DEFAULT '{}'::text[],
    client_meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    user_id text,
    idempotency_key text,
    cost integer DEFAULT 0,
    cost_pool text,
    provider_id text,
    model_id text,
    provider_key text,
    provider_task_id text,
    resume_meta jsonb DEFAULT '{}'::jsonb
);


--
-- Name: media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media (
    id text NOT NULL,
    title text DEFAULT ''::text,
    type text DEFAULT 'image'::text,
    thumbnail text DEFAULT ''::text,
    full_url text DEFAULT ''::text,
    prompt text DEFAULT ''::text,
    model text DEFAULT ''::text,
    ratio text DEFAULT '1:1'::text,
    source text DEFAULT 'user'::text,
    is_favorite boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    oss_url text DEFAULT ''::text,
    oss_object_key text DEFAULT ''::text,
    oss_uploaded boolean DEFAULT false,
    category text DEFAULT 'generated'::text,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'success'::text,
    error_message text DEFAULT ''::text,
    failed_at timestamp with time zone,
    user_id text,
    is_default boolean DEFAULT false,
    default_key text,
    file_size bigint,
    tags jsonb DEFAULT '[]'::jsonb,
    character_id text,
    reference_style_id text
);


--
-- Name: model_cost_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_cost_rates (
    id text DEFAULT ('mcr-'::text || (gen_random_uuid())::text) NOT NULL,
    provider_id text NOT NULL,
    model_id text NOT NULL,
    model_type text DEFAULT 'text'::text,
    input_cost_per_1k numeric DEFAULT 0,
    output_cost_per_1k numeric DEFAULT 0,
    cost_per_unit numeric DEFAULT 0,
    currency text DEFAULT 'CNY'::text,
    source text DEFAULT 'manual'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: model_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_price_history (
    id text DEFAULT ('mph-'::text || (gen_random_uuid())::text) NOT NULL,
    model_id text NOT NULL,
    display_name text DEFAULT ''::text,
    credit_cost integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.models (
    id text NOT NULL,
    model_id text NOT NULL,
    display_name text NOT NULL,
    type text DEFAULT 'image'::text NOT NULL,
    provider_id text,
    enabled boolean DEFAULT true,
    supported_resolutions text[] DEFAULT '{}'::text[],
    capabilities jsonb DEFAULT '{}'::jsonb,
    endpoint jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    mapping_name text DEFAULT ''::text,
    credit_cost integer DEFAULT 0,
    estimated_seconds integer DEFAULT 0,
    category text DEFAULT ''::text,
    creator jsonb DEFAULT '{}'::jsonb,
    commercial_use boolean DEFAULT true,
    max_concurrent integer,
    supports_reward_balance boolean DEFAULT true NOT NULL,
    reward_credits_required integer DEFAULT 0 NOT NULL,
    param_template jsonb DEFAULT '{}'::jsonb
);


--
-- Name: oss_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oss_config (
    id integer DEFAULT 1 NOT NULL,
    provider text DEFAULT 'aliyun-oss'::text,
    access_point_name text DEFAULT ''::text,
    endpoint_external text DEFAULT ''::text,
    endpoint_internal text DEFAULT ''::text,
    bucket text DEFAULT ''::text,
    region text DEFAULT ''::text,
    region_label text DEFAULT ''::text,
    access_key_id text DEFAULT ''::text,
    access_key_secret text DEFAULT ''::text,
    path_prefix text DEFAULT 'images/'::text,
    custom_domain text DEFAULT ''::text,
    enabled boolean DEFAULT true,
    active_id text DEFAULT ''::text
);


--
-- Name: oss_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oss_configs (
    id text NOT NULL,
    provider_type text DEFAULT 'aliyun-oss'::text NOT NULL,
    display_name text DEFAULT ''::text,
    bucket text DEFAULT ''::text,
    region text DEFAULT ''::text,
    region_label text DEFAULT ''::text,
    app_id text DEFAULT ''::text,
    access_key_id text DEFAULT ''::text,
    access_key_secret text DEFAULT ''::text,
    endpoint_external text DEFAULT ''::text,
    path_prefix text DEFAULT 'images/'::text,
    custom_domain text DEFAULT ''::text,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id bigint NOT NULL,
    aggregate text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbox_id_seq OWNED BY public.outbox.id;


--
-- Name: payment_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_audit (
    id bigint NOT NULL,
    event_type text NOT NULL,
    actor text DEFAULT ''::text,
    user_id text,
    order_id text,
    provider_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_audit_id_seq OWNED BY public.payment_audit.id;


--
-- Name: payment_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_providers (
    id text DEFAULT ('pp-'::text || (gen_random_uuid())::text) NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    type text DEFAULT 'easypay'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    api_base text DEFAULT ''::text,
    pid_enc text,
    pkey_enc text,
    webhook_secret_enc text,
    product_name_prefix text DEFAULT '充值'::text,
    allow_refund boolean DEFAULT false NOT NULL,
    remark text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supported_methods jsonb DEFAULT '["alipay", "wxpay"]'::jsonb
);


--
-- Name: payment_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_settings (
    id integer DEFAULT 1 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    default_expires_min integer DEFAULT 15 NOT NULL,
    min_amount integer DEFAULT 100 NOT NULL,
    max_amount integer DEFAULT 10000000 NOT NULL,
    daily_limit integer DEFAULT 10000000 NOT NULL,
    max_open_orders integer DEFAULT 5 NOT NULL,
    allow_test boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enable_wxpay boolean DEFAULT true NOT NULL,
    enable_alipay boolean DEFAULT true NOT NULL,
    CONSTRAINT payment_settings_id_check CHECK ((id = 1))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id text DEFAULT ('prod-'::text || (gen_random_uuid())::text) NOT NULL,
    title text NOT NULL,
    subtitle text DEFAULT ''::text,
    cover_url text DEFAULT ''::text,
    kind text DEFAULT 'skill_pack'::text,
    ref_key text DEFAULT ''::text,
    price_credits integer DEFAULT 0,
    price_cents integer DEFAULT 0,
    status text DEFAULT 'published'::text,
    author text DEFAULT ''::text,
    description text DEFAULT ''::text,
    tags text[] DEFAULT '{}'::text[],
    installs integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers (
    id text NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'official'::text NOT NULL,
    base_url text DEFAULT ''::text NOT NULL,
    api_key text DEFAULT ''::text,
    supported_types text[] DEFAULT '{}'::text[],
    enabled boolean DEFAULT true,
    protocol text DEFAULT 'openai-compatible'::text,
    remark text DEFAULT ''::text,
    default_endpoint jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    max_concurrent integer DEFAULT 2,
    rate_limits jsonb DEFAULT '{"1k": 20, "2k": 10, "4k": 1}'::jsonb,
    capacity_model text DEFAULT 'limited'::text,
    bucket_max integer,
    cooldown_ms integer DEFAULT 60000
);


--
-- Name: recharge_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recharge_orders (
    id text NOT NULL,
    user_id text NOT NULL,
    channel text DEFAULT 'wechat'::text NOT NULL,
    amount integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    pay_order_no text NOT NULL,
    sign text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb,
    provider_id text,
    channel_trade_no text,
    channel_method text,
    channel_raw jsonb DEFAULT '{}'::jsonb,
    expired_at timestamp with time zone,
    fail_reason text,
    package_id text,
    bonus integer DEFAULT 0 NOT NULL
);


--
-- Name: reference_styles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reference_styles (
    id text DEFAULT ('rs-'::text || (gen_random_uuid())::text) NOT NULL,
    user_id text,
    name text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text,
    preview_url text DEFAULT ''::text NOT NULL,
    full_url text DEFAULT ''::text,
    prompt text DEFAULT ''::text,
    negative_prompt text DEFAULT ''::text,
    model_id text DEFAULT ''::text,
    ratio text DEFAULT '1:1'::text,
    tags jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    ai_reason text DEFAULT ''::text,
    reject_reason text DEFAULT ''::text,
    source_media_id text,
    reviewed_by text DEFAULT ''::text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_promoted boolean DEFAULT false,
    commission_rate integer DEFAULT 0
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    token_hash text NOT NULL,
    user_id text NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id text NOT NULL,
    user_id text,
    type text DEFAULT 'other'::text,
    target_url text DEFAULT ''::text,
    content text DEFAULT ''::text,
    evidence text DEFAULT ''::text,
    contact text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: request_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_logs (
    id bigint NOT NULL,
    method text,
    path text,
    ip text,
    status integer,
    latency_ms integer,
    user_id text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: request_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.request_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: request_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.request_logs_id_seq OWNED BY public.request_logs.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id bigint NOT NULL,
    order_id text NOT NULL,
    carrier character varying(32) DEFAULT ''::character varying,
    tracking_no character varying(64) DEFAULT ''::character varying,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipments_id_seq OWNED BY public.shipments.id;


--
-- Name: skill_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_registry (
    key text NOT NULL,
    name text NOT NULL,
    stage text DEFAULT 'generation'::text,
    adapter text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb,
    cost_credits integer DEFAULT 0,
    enabled boolean DEFAULT true,
    description text DEFAULT ''::text,
    author text DEFAULT ''::text,
    icon text DEFAULT ''::text,
    version text DEFAULT '1.0.0'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: studio_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studio_projects (
    id text DEFAULT ('proj-'::text || (gen_random_uuid())::text) NOT NULL,
    owner_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    type text DEFAULT 'story'::text NOT NULL,
    status text DEFAULT 'planning'::text NOT NULL,
    current_stage text DEFAULT 'idea'::text NOT NULL,
    description text DEFAULT ''::text,
    cover_url text DEFAULT ''::text,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: style_earnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.style_earnings (
    id text DEFAULT ('se-'::text || (gen_random_uuid())::text) NOT NULL,
    reference_style_id text,
    designer_id text,
    customer_id text,
    media_id text,
    charge_credits integer DEFAULT 0,
    commission_credits integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_error_logs (
    id bigint NOT NULL,
    category text DEFAULT 'app'::text,
    source text DEFAULT 'app'::text,
    message text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb,
    stack text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_error_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_error_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_error_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_error_logs_id_seq OWNED BY public.system_error_logs.id;


--
-- Name: topup_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topup_packages (
    id text DEFAULT ('pkg-'::text || (gen_random_uuid())::text) NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    credits integer DEFAULT 0 NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    bonus integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    remark text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_skills (
    user_id text NOT NULL,
    skill_key text NOT NULL,
    acquired_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text DEFAULT ('u-'::text || (gen_random_uuid())::text) NOT NULL,
    email text NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    plan_expires_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    reward_credits integer DEFAULT 0 NOT NULL,
    recharge_credits integer DEFAULT 0 NOT NULL,
    credits integer GENERATED ALWAYS AS ((reward_credits + recharge_credits)) STORED
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id bigint NOT NULL,
    provider_id text,
    channel_trade_no text NOT NULL,
    event_type text DEFAULT 'paid'::text NOT NULL,
    out_trade_no text,
    status text DEFAULT 'new'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    raw jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- Name: agent_calls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_calls ALTER COLUMN id SET DEFAULT nextval('public.agent_calls_id_seq'::regclass);


--
-- Name: agent_rule_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_rule_logs ALTER COLUMN id SET DEFAULT nextval('public.agent_rule_logs_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: consumption_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumption_ledger ALTER COLUMN id SET DEFAULT nextval('public.consumption_ledger_id_seq'::regclass);


--
-- Name: coupons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons ALTER COLUMN id SET DEFAULT nextval('public.coupons_id_seq'::regclass);


--
-- Name: credit_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions ALTER COLUMN id SET DEFAULT nextval('public.credit_transactions_id_seq'::regclass);


--
-- Name: outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox ALTER COLUMN id SET DEFAULT nextval('public.outbox_id_seq'::regclass);


--
-- Name: payment_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_audit ALTER COLUMN id SET DEFAULT nextval('public.payment_audit_id_seq'::regclass);


--
-- Name: request_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_logs ALTER COLUMN id SET DEFAULT nextval('public.request_logs_id_seq'::regclass);


--
-- Name: shipments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments ALTER COLUMN id SET DEFAULT nextval('public.shipments_id_seq'::regclass);


--
-- Name: system_error_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_error_logs ALTER COLUMN id SET DEFAULT nextval('public.system_error_logs_id_seq'::regclass);


--
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- Name: agent_calls agent_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_calls
    ADD CONSTRAINT agent_calls_pkey PRIMARY KEY (id);


--
-- Name: agent_providers agent_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_providers
    ADD CONSTRAINT agent_providers_pkey PRIMARY KEY (id);


--
-- Name: agent_rule_logs agent_rule_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_rule_logs
    ADD CONSTRAINT agent_rule_logs_pkey PRIMARY KEY (id);


--
-- Name: agent_rules agent_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_rules
    ADD CONSTRAINT agent_rules_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: consumption_ledger consumption_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumption_ledger
    ADD CONSTRAINT consumption_ledger_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: cron_marker cron_marker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_marker
    ADD CONSTRAINT cron_marker_pkey PRIMARY KEY (name);


--
-- Name: default_assets default_assets_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_assets
    ADD CONSTRAINT default_assets_key_key UNIQUE (key);


--
-- Name: default_assets default_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_assets
    ADD CONSTRAINT default_assets_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: generation_tasks generation_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_tasks
    ADD CONSTRAINT generation_tasks_pkey PRIMARY KEY (task_id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: model_cost_rates model_cost_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_cost_rates
    ADD CONSTRAINT model_cost_rates_pkey PRIMARY KEY (id);


--
-- Name: model_cost_rates model_cost_rates_provider_id_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_cost_rates
    ADD CONSTRAINT model_cost_rates_provider_id_model_id_key UNIQUE (provider_id, model_id);


--
-- Name: model_price_history model_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_price_history
    ADD CONSTRAINT model_price_history_pkey PRIMARY KEY (id);


--
-- Name: models models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_pkey PRIMARY KEY (id);


--
-- Name: oss_config oss_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oss_config
    ADD CONSTRAINT oss_config_pkey PRIMARY KEY (id);


--
-- Name: oss_configs oss_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oss_configs
    ADD CONSTRAINT oss_configs_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: payment_audit payment_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_audit
    ADD CONSTRAINT payment_audit_pkey PRIMARY KEY (id);


--
-- Name: payment_providers payment_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_providers
    ADD CONSTRAINT payment_providers_pkey PRIMARY KEY (id);


--
-- Name: payment_settings payment_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_settings
    ADD CONSTRAINT payment_settings_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: recharge_orders recharge_orders_pay_order_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recharge_orders
    ADD CONSTRAINT recharge_orders_pay_order_no_key UNIQUE (pay_order_no);


--
-- Name: recharge_orders recharge_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recharge_orders
    ADD CONSTRAINT recharge_orders_pkey PRIMARY KEY (id);


--
-- Name: reference_styles reference_styles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_styles
    ADD CONSTRAINT reference_styles_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: request_logs request_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_logs
    ADD CONSTRAINT request_logs_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: skill_registry skill_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_registry
    ADD CONSTRAINT skill_registry_pkey PRIMARY KEY (key);


--
-- Name: studio_projects studio_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_projects
    ADD CONSTRAINT studio_projects_pkey PRIMARY KEY (id);


--
-- Name: style_earnings style_earnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_earnings
    ADD CONSTRAINT style_earnings_pkey PRIMARY KEY (id);


--
-- Name: system_error_logs system_error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_error_logs
    ADD CONSTRAINT system_error_logs_pkey PRIMARY KEY (id);


--
-- Name: topup_packages topup_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topup_packages
    ADD CONSTRAINT topup_packages_pkey PRIMARY KEY (id);


--
-- Name: user_skills user_skills_user_id_skill_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_user_id_skill_key_key UNIQUE (user_id, skill_key);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_provider_id_channel_trade_no_event_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_provider_id_channel_trade_no_event_type_key UNIQUE (provider_id, channel_trade_no, event_type);


--
-- Name: generation_tasks_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_tasks_created_at_idx ON public.generation_tasks USING btree (created_at);


--
-- Name: generation_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_tasks_status_idx ON public.generation_tasks USING btree (status);


--
-- Name: ix_ac_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ac_created ON public.agent_calls USING btree (created_at DESC);


--
-- Name: ix_agents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_agents_type ON public.agents USING btree (agent_type);


--
-- Name: ix_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_created ON public.audit_logs USING btree (created_at DESC);


--
-- Name: ix_cl_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cl_actor ON public.consumption_ledger USING btree (actor_id, created_at DESC);


--
-- Name: ix_cl_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cl_idem ON public.consumption_ledger USING btree (idempotency_key) WHERE (idempotency_key <> ''::text);


--
-- Name: ix_cl_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cl_purpose ON public.consumption_ledger USING btree (purpose, created_at DESC);


--
-- Name: ix_cl_scope_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cl_scope_time ON public.consumption_ledger USING btree (scope, created_at DESC);


--
-- Name: ix_ct_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ct_ref ON public.credit_transactions USING btree (ref);


--
-- Name: ix_ct_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ct_user ON public.credit_transactions USING btree (user_id);


--
-- Name: ix_gt_provider_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gt_provider_task ON public.generation_tasks USING btree (provider_task_id) WHERE (provider_task_id IS NOT NULL);


--
-- Name: ix_gt_running_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gt_running_provider ON public.generation_tasks USING btree (status, provider_task_id) WHERE ((status = 'running'::text) AND (provider_task_id IS NOT NULL));


--
-- Name: ix_gt_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gt_user ON public.generation_tasks USING btree (user_id);


--
-- Name: ix_mcr_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_mcr_provider ON public.model_cost_rates USING btree (provider_id);


--
-- Name: ix_media_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_media_default ON public.media USING btree (user_id, default_key) WHERE (default_key IS NOT NULL);


--
-- Name: ix_media_style; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_media_style ON public.media USING btree (reference_style_id) WHERE (reference_style_id IS NOT NULL);


--
-- Name: ix_media_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_media_user ON public.media USING btree (user_id);


--
-- Name: ix_mph_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_mph_model ON public.model_price_history USING btree (model_id, updated_at DESC);


--
-- Name: ix_outbox_unpub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbox_unpub ON public.outbox USING btree (published) WHERE (published = false);


--
-- Name: ix_pa_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pa_created ON public.payment_audit USING btree (created_at DESC);


--
-- Name: ix_pp_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pp_enabled ON public.payment_providers USING btree (enabled, sort_order);


--
-- Name: ix_prod_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_prod_status ON public.products USING btree (status, created_at DESC);


--
-- Name: ix_reference_styles_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reference_styles_created ON public.reference_styles USING btree (created_at DESC);


--
-- Name: ix_reference_styles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reference_styles_status ON public.reference_styles USING btree (status);


--
-- Name: ix_reference_styles_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reference_styles_tags ON public.reference_styles USING gin (tags);


--
-- Name: ix_reference_styles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_reference_styles_user ON public.reference_styles USING btree (user_id);


--
-- Name: ix_ro_ctrade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ro_ctrade ON public.recharge_orders USING btree (channel_trade_no);


--
-- Name: ix_ro_payno; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ro_payno ON public.recharge_orders USING btree (pay_order_no);


--
-- Name: ix_ro_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ro_provider ON public.recharge_orders USING btree (provider_id);


--
-- Name: ix_ro_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ro_status ON public.recharge_orders USING btree (status, created_at DESC);


--
-- Name: ix_ro_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ro_user ON public.recharge_orders USING btree (user_id);


--
-- Name: ix_sel_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sel_category ON public.system_error_logs USING btree (category);


--
-- Name: ix_sel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sel_created ON public.system_error_logs USING btree (created_at DESC);


--
-- Name: ix_sr_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sr_enabled ON public.skill_registry USING btree (enabled);


--
-- Name: ix_studio_owner_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_studio_owner_updated ON public.studio_projects USING btree (owner_id, updated_at DESC);


--
-- Name: ix_style_earnings_designer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_style_earnings_designer ON public.style_earnings USING btree (designer_id);


--
-- Name: ix_style_earnings_style; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_style_earnings_style ON public.style_earnings USING btree (reference_style_id);


--
-- Name: ix_tp_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tp_sort ON public.topup_packages USING btree (sort_order);


--
-- Name: ix_us_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_us_user ON public.user_skills USING btree (user_id);


--
-- Name: ix_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_status ON public.users USING btree (status);


--
-- Name: ix_we_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_we_pending ON public.webhook_events USING btree (status, updated_at) WHERE (status = ANY (ARRAY['new'::text, 'processing'::text, 'failed'::text]));


--
-- Name: ux_gt_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_gt_idem ON public.generation_tasks USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: agent_providers agent_providers_agent_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_providers
    ADD CONSTRAINT agent_providers_agent_key_fkey FOREIGN KEY (agent_key) REFERENCES public.agents(key) ON DELETE CASCADE;


--
-- Name: credit_transactions credit_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: generation_tasks generation_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_tasks
    ADD CONSTRAINT generation_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: media media_reference_style_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_reference_style_id_fkey FOREIGN KEY (reference_style_id) REFERENCES public.reference_styles(id) ON DELETE SET NULL;


--
-- Name: media media_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: models models_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.models
    ADD CONSTRAINT models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;


--
-- Name: recharge_orders recharge_orders_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recharge_orders
    ADD CONSTRAINT recharge_orders_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.payment_providers(id) ON DELETE SET NULL;


--
-- Name: recharge_orders recharge_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recharge_orders
    ADD CONSTRAINT recharge_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reference_styles reference_styles_source_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_styles
    ADD CONSTRAINT reference_styles_source_media_id_fkey FOREIGN KEY (source_media_id) REFERENCES public.media(id) ON DELETE SET NULL;


--
-- Name: reference_styles reference_styles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reference_styles
    ADD CONSTRAINT reference_styles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: studio_projects studio_projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_projects
    ADD CONSTRAINT studio_projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: style_earnings style_earnings_reference_style_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_earnings
    ADD CONSTRAINT style_earnings_reference_style_id_fkey FOREIGN KEY (reference_style_id) REFERENCES public.reference_styles(id) ON DELETE SET NULL;


--
-- Name: user_skills user_skills_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

