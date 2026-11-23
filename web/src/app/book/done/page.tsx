// Stripe sends the guest here after the card is authorised. The booking only moves to
// "awaiting approval" when Stripe's signed webhook says so (step 5), so this page
// never claims more than Stripe has confirmed to us.
import type { Metadata } from "next";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { bookingBySession } from "@/lib/payments/checkout";
import { BookingSummary, BookShell } from "../booking-summary";

export const metadata: Metadata = { title: "Booking received", robots: { index: false } };

export default function DonePage({ searchParams }: PageProps<"/book/done">) {
  return (
    <BookShell>
      <Suspense fallback={<p className="text-muted">Loading your booking…</p>}>
        <Done searchParams={searchParams} />
      </Suspense>
    </BookShell>
  );
}

async function Done({ searchParams }: Pick<PageProps<"/book/done">, "searchParams">) {
  const id = (await searchParams).session_id;
  const booking = typeof id === "string" && id.startsWith("cs_") ? await bookingBySession(getDb(), id) : null;
  if (!booking) {
    return <h1 className="text-2xl font-semibold text-navy">We couldn’t find that booking.</h1>;
  }
  const waiting = booking.status === "AWAITING_APPROVAL" || booking.status === "HOLD";
  return (
    <>
      <h1 className="text-3xl font-semibold text-navy">
        {booking.status === "CONFIRMED" ? "Your stay is confirmed" : "Thanks, your request is with the host"}
      </h1>
      {waiting && (
        <p className="text-muted">
          Your card has been authorised, not charged. The host reviews your request and you’ll get an email either way.
          You’re charged only if the host accepts.
        </p>
      )}
      <BookingSummary booking={booking} />
      <p className="text-sm text-muted">Keep your booking code. You can look the booking up with it and your email.</p>
    </>
  );
}
