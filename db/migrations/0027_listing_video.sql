-- A short video on a listing (optional, one per listing, up to 60 seconds). The phone turns it into an H.264 MP4
-- before sending, so it plays on any phone. Stored in R2 next to the photos, with a light copy for data saver
-- (<key>.small) and a still frame shown before it plays (<key>.poster). See @noshen/engine/photos.
alter table listings
  add column video_key text
    check (video_key is null or video_key ~ '^listings/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm)$'),
  add column video_seconds integer
    check (video_seconds is null or video_seconds between 0 and 600);
