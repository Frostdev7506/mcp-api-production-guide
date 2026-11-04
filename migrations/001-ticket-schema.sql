CREATE SEQUENCE ticket_number START 301;
CREATE TABLE tickets (
 id text PRIMARY KEY DEFAULT ('T' || nextval('ticket_number')),
 tenant_id text NOT NULL,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
 description text NOT NULL CHECK (length(description) <= 4000),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
 priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high'))
);
CREATE INDEX tickets_tenant_id ON tickets(tenant_id,id);
CREATE TABLE ticket_drafts (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 subject_id text NOT NULL,
 title text NOT NULL,
 description text NOT NULL,
 priority text NOT NULL,
 expires_at timestamptz NOT NULL,
 ticket_id text REFERENCES tickets(id)
);
CREATE TABLE rate_limits (
 principal_key text PRIMARY KEY,
 window_start timestamptz NOT NULL,
 used integer NOT NULL
);
GRANT CONNECT ON DATABASE support TO support_app;
GRANT USAGE ON SCHEMA public TO support_app;
GRANT SELECT,INSERT,UPDATE ON tickets,ticket_drafts,rate_limits TO support_app;
GRANT USAGE,SELECT ON SEQUENCE ticket_number TO support_app;