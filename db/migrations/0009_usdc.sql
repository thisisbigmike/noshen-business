-- USDC as well as USDT. A crypto payment now records which coin it was in, and the USDT-only names become general:
-- payments.method 'usdt' is now 'crypto' (with coin 'usdt' or 'usdc'), and amounts are in millionths of the coin.

alter table crypto_deposits add column coin text not null default 'usdt' check (coin in ('usdt', 'usdc'));
alter table crypto_deposits alter column coin drop default;
alter table crypto_deposits rename column usdt_micro to amount_micro;
alter table crypto_deposits rename column rate_kobo_per_usdt to rate_kobo;  -- naira (in kobo) for one coin
alter table crypto_deposits drop constraint crypto_deposits_deal_id_network_key;
alter table crypto_deposits add constraint crypto_deposits_one_per_coin_network unique (deal_id, coin, network);

alter table payments drop constraint payments_usdt_details;
alter table payments drop constraint payments_method_check;
update payments set method = 'crypto' where method = 'usdt';
alter table payments add constraint payments_method_check check (method in ('bank', 'crypto'));
alter table payments add column coin text check (coin in ('usdt', 'usdc'));
update payments set coin = 'usdt' where method = 'crypto';
alter table payments rename column amount_usdt_micro to amount_coin_micro;
alter table payments add constraint payments_crypto_details
  check (method <> 'crypto' or (coin is not null and network is not null and tx_hash is not null and amount_coin_micro is not null));
