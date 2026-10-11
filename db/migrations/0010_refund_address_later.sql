-- The deal's address is shown as soon as the buyer picks a coin and network: they don't have to give their own
-- address first. They give it, for refunds, when they like; a USDT or USDC refund waits (its transfer stays
-- pending, unsent) until they do.
alter table crypto_deposits alter column refund_address_enc drop not null;
alter table crypto_deposits alter column refund_address_last4 drop not null;
