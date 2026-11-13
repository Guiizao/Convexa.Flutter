-- Banco próprio da automação. A agenda continua na ConvexaAPI; aqui fica só o
-- que a ConvexaAPI não modela: vínculo, configurações do bot, conversa,
-- pagamentos, campanhas, Google e Alexa.

CREATE TABLE business_link (
  business_id          uuid PRIMARY KEY,
  meta_phone_number_id text UNIQUE,
  business_name        text NOT NULL,
  timezone             text NOT NULL DEFAULT 'America/Sao_Paulo',
  owner_email          text,
  owner_password_enc   text,
  status               text NOT NULL DEFAULT 'pending', -- pending | active | broken
  last_error           text,
  linked_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bot_settings (
  business_id uuid PRIMARY KEY,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets_enc text,                 -- JSON cifrado: token do Mercado Pago etc.
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation (
  business_id     uuid NOT NULL,
  phone           text NOT NULL,     -- E.164 (+55...)
  wa_id           text,              -- como a Meta identifica (pode vir sem o 9)
  name            text,
  state           jsonb NOT NULL DEFAULT '{}'::jsonb,
  role            text NOT NULL DEFAULT 'customer', -- customer | owner
  paused_until    timestamptz,       -- atendimento humano
  last_inbound_at timestamptz,       -- regra das 24h da Meta
  last_outbound_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, phone)
);

CREATE TABLE message_log (
  id          bigserial PRIMARY KEY,
  business_id uuid NOT NULL,
  phone       text NOT NULL,
  direction   text NOT NULL,        -- in | out
  kind        text NOT NULL,        -- text | buttons | list | image | template | interactive_reply | media ...
  body        text,
  payload     jsonb,
  wamid       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_log_conv_idx ON message_log (business_id, phone, created_at DESC);
CREATE UNIQUE INDEX message_log_wamid_in_idx ON message_log (wamid) WHERE direction = 'in' AND wamid IS NOT NULL;

CREATE TABLE payment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL,
  appointment_id   uuid NOT NULL,
  customer_phone   text NOT NULL,
  customer_name    text,
  kind             text NOT NULL,   -- deposit | full
  amount_cents     integer NOT NULL CHECK (amount_cents > 0),
  discount_cents   integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  status           text NOT NULL DEFAULT 'pending', -- pending | under_review | paid | rejected | expired | cancelled
  provider         text NOT NULL,   -- static_pix | mercadopago
  provider_ref     text,
  txid             text NOT NULL,
  pix_code         text NOT NULL,
  receipt_media    jsonb,           -- { mimeType, sha256, size }
  receipt_analysis jsonb,
  appointment_summary jsonb,        -- serviço, dia, hora, profissional (para mensagens)
  expires_at       timestamptz,
  paid_at          timestamptz,
  decided_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_business_status_idx ON payment (business_id, status);
CREATE INDEX payment_appointment_idx ON payment (appointment_id);
CREATE UNIQUE INDEX payment_provider_ref_idx ON payment (provider, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE payment_receipt (
  payment_id uuid PRIMARY KEY REFERENCES payment(id) ON DELETE CASCADE,
  mime_type  text NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  kind        text NOT NULL,        -- reschedule | notice
  reason      text,
  message     text,
  status      text NOT NULL DEFAULT 'open', -- open | done
  created_by  text NOT NULL,        -- whatsapp | alexa | panel
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_target (
  campaign_id    uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  customer_phone text NOT NULL,
  customer_name  text,
  status         text NOT NULL DEFAULT 'notified', -- notified | rescheduled | cancelled | kept | no_response | failed
  detail         text,
  notified_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, appointment_id)
);

CREATE TABLE reminder_sent (
  appointment_id uuid NOT NULL,
  kind           text NOT NULL,     -- 24h | 2h
  start_at       timestamptz NOT NULL, -- remarcou? lembra de novo
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, kind, start_at)
);

CREATE TABLE google_link (
  business_id       uuid PRIMARY KEY,
  email             text,
  refresh_token_enc text NOT NULL,
  calendar_id       text NOT NULL DEFAULT 'primary',
  status            text NOT NULL DEFAULT 'active',
  last_error        text,
  last_sync_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_event (
  business_id    uuid NOT NULL,
  appointment_id uuid NOT NULL,
  event_id       text NOT NULL,
  content_hash   text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, appointment_id)
);

CREATE TABLE google_block (
  business_id   uuid NOT NULL,
  event_id      text NOT NULL,
  time_block_id uuid NOT NULL,
  content_hash  text NOT NULL,
  PRIMARY KEY (business_id, event_id)
);

CREATE TABLE alexa_link (
  alexa_user_id text PRIMARY KEY,
  business_id   uuid NOT NULL,
  linked_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE link_code (
  code        text PRIMARY KEY,
  business_id uuid NOT NULL,
  purpose     text NOT NULL,        -- alexa | google_state
  expires_at  timestamptz NOT NULL
);

CREATE TABLE job_lock (
  name        text PRIMARY KEY,
  locked_until timestamptz NOT NULL
);
