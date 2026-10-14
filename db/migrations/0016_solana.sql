-- NosHen's own Solana wallet: deals' addresses are read from the chain instead of a partner's webhooks.
-- watched_until is the newest transaction already looked at for a deposit, so each check only fetches what's new.
alter table crypto_deposits add column watched_until text;
