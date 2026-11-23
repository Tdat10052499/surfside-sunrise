// Shared by the pages Stripe sends the guest back to. Plain until the public pages
// are ported from the prototype (BookAwaiting, BookFailed).
import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsd } from "@/lib/money";
import type { GuestBooking } from "@/lib/payments/checkout";

export function BookShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-12 text-[#1b2633] sm:px-8">
      <Link href="/" className="font-semibold text-navy">
        Seathesunrise
      </Link>
      {children}
    </main>
  );
}

export function BookingSummary({
  booking,
}: {
  booking: Omit<GuestBooking, "lines"> & { lines: GuestBooking["lines"] };
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-2xl bg-wall p-5 text-sm">
      <dt className="text-muted">Booking code</dt>
      <dd className="font-semibold tracking-wide">{booking.code}</dd>
      <dt className="text-muted">Home</dt>
      <dd>{booking.homeName}</dd>
      <dt className="text-muted">Dates</dt>
      <dd>
        {booking.checkIn} to {booking.checkOut}
      </dd>
      <dt className="text-muted">Guests</dt>
      <dd>
        {booking.guests}
        {booking.pets > 0 ? `, ${booking.pets} pet${booking.pets === 1 ? "" : "s"}` : ""}
      </dd>
      {booking.totalCents !== null && (
        <>
          <dt className="text-muted">Total</dt>
          <dd className="font-semibold">{formatUsd(booking.totalCents)}</dd>
        </>
      )}
    </dl>
  );
}
