-- A profile picture: a photo of the person or their shop's logo, shown with their name on listings, their shop,
-- "Check a seller" and their deals. Stored in R2 under avatars/<user id>/; a new photo replaces the old one.
alter table users add column photo_key text
  check (photo_key is null or photo_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|heic)$');
