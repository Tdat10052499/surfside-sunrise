-- Step 6: the host approves, declines, cancels, refunds or moves a booking.

-- Deadline for the host's decision, set when the card is authorised. A card
-- authorisation lasts about 7 days, so it is never later than that.
alter table bookings
  add column approve_by       timestamptz,
  add column decided_at       timestamptz,
  add column refunded_cents   integer not null default 0 check (refunded_cents >= 0),
  -- The host's own note on a decline, cancellation or date change (not shown to the guest).
  add column host_note        text;

alter table bookings drop constraint bookings_status_reason_check;
alter table bookings add constraint bookings_status_reason_check check (
  status_reason in (
    'CHECKOUT_EXPIRED', 'PAYMENT_CANCELED', 'AMOUNT_MISMATCH', 'DATES_TAKEN',
    'APPROVAL_TIMEOUT', 'HOST_DECLINED', 'HOST_CANCELLED'
  )
);

create index bookings_awaiting on bookings (approve_by) where status = 'AWAITING_APPROVAL';
