CREATE TABLE IF NOT EXISTS public.tab_push_subscription (
	seq_registro serial PRIMARY KEY,
	schema_name varchar(50) NOT NULL,
	scope varchar(50) NOT NULL DEFAULT 'agenda',
	endpoint text NOT NULL,
	p256dh text NOT NULL,
	auth text NOT NULL,
	subscription_json jsonb,
	device_name varchar(120),
	user_agent text,
	expiration_time timestamp NULL,
	ind_active boolean NOT NULL DEFAULT true,
	created_at timestamp NOT NULL DEFAULT NOW(),
	updated_at timestamp NOT NULL DEFAULT NOW(),
	last_seen_at timestamp NULL,
	CONSTRAINT tab_push_subscription_schema_scope_endpoint_uniq UNIQUE (schema_name, scope, endpoint)
);
