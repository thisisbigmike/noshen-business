-- Sizes for clothes, shoes, hair and baby items: the kind of size (EU, UK, US, S/M/L, waist, inches, age) and the
-- size itself. The app checks them against the lists in @noshen/shared/sizes; here, only that they come together.
alter table listings
  add column size_system text check (size_system is null or length(size_system) <= 12),
  add column size        text check (size is null or length(size) <= 24),
  add constraint listings_size_with_system check ((size is null) = (size_system is null));
