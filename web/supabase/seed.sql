-- Development seed. Facts come from the Airbnb listing and the client's requirements.
-- Anything the owner has not confirmed is left out and marked TODO.

insert into properties (slug, name, status, max_guests, max_pets, min_nights,
                        cleaning_fee_cents, pet_fee_cents)
values ('surfside-sunrise-house', 'Surfside Sunrise House', 'PUBLISHED', 8,
        null,   -- TODO: owner to confirm the maximum number of pets
        1,      -- TODO: owner to confirm minimum nights
        17500,  -- cleaning fee, USD 175 per stay (§3)
        5000);  -- pet fee, USD 50 per pet per stay (§3)

-- TODO: nightly, weekend and seasonal rates are not known yet, so no rate_rules
-- rows are seeded. Quotes fail with RATE_MISSING until the owner sets a base rate.
-- TODO: hotel occupancy taxes are not seeded until the owner/CPA confirms them.

-- Host contact (§2). Shown on the site and editable in the dashboard.
insert into site_settings (key, value)
values ('host_contact', '{
  "name": "Ngoc Anh Ta",
  "title": "Realtor",
  "phone": "408-668-4189",
  "email": "ngocanhrealtor@gmail.com"
}'::jsonb);
