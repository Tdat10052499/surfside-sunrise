-- Step 5: Stripe webhook. Why a booking left the normal path (shown to the owner in
-- the dashboard and used for the guest's "payment failed" page). Null when nothing
-- went wrong.
alter table bookings
  add column status_reason text check (
    status_reason in ('CHECKOUT_EXPIRED', 'PAYMENT_CANCELED', 'AMOUNT_MISMATCH', 'DATES_TAKEN')
  );
