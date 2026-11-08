ALTER TABLE users ADD COLUMN is_premium integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE matches ADD COLUMN premium_owner_id integer;
