// Stripe sends the guest here after Checkout. What the page says follows the booking's
// status, which only Stripe's signed webhook moves (step 5): it never claims more than
// Stripe has confirmed to us (§5: success, failure and "still processing").
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { bookingBySession, type GuestBooking } from "@/lib/payments/checkout";
import { BookingSummary, BookShell } from "../booking-summary";
import { RefreshWhilePending } from "./refresh";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

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
  const { title, body } = message(booking);
  return (
    <>
      {booking.status === "HOLD" && <RefreshWhilePending />}
      <h1 className="text-3xl font-semibold text-navy" role="status">
        {title}
      </h1>
      <p className="text-muted">{body}</p>
      <BookingSummary booking={booking} />
      {booking.status === "EXPIRED" ? (
        <Link href="/" className="font-semibold text-gulf-ink underline">
          Choose dates again
        </Link>
      ) : (
        <p className="text-sm text-muted">
          Keep your booking code. You can look the booking up with it and your email.
        </p>
      )}
    </>
  );
}

function message(b: GuestBooking): { title: string; body: string } {
  switch (b.status) {
    case "HOLD":
      return {
        title: "Confirming your payment…",
        body: "We’re waiting for the card network to confirm the authorisation. This usually takes a few seconds; this page updates by itself.",
      };
    case "AWAITING_APPROVAL":
      return {
        title: "Thanks, your request is with the host",
        body: "Your card has been authorised, not charged. The host reviews your request and you’ll get an email either way. You’re charged only if the host accepts.",
      };
    case "CONFIRMED":
      return { title: "Your stay is confirmed", body: "Your payment went through. See you at the beach." };
    case "EXPIRED":
      return {
        title: b.statusReason === "DATES_TAKEN" ? "Those dates were just taken" : "The payment didn’t go through",
        body:
          b.statusReason === "DATES_TAKEN"
            ? "Your card was not charged and the authorisation has been released. Please pick other dates."
            : "Your card was not charged, and the dates are no longer held. You can start again whenever you’re ready.",
      };
    default:
      return { title: "Your booking", body: "Contact the host with your booking code if anything looks wrong." };
  }
}
