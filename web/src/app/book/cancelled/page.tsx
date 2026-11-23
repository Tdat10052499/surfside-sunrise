// Stripe sends the guest here when they leave the payment page. The nights are freed
// at once and the Checkout Session is closed so it can't be paid later.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { cancelCheckout } from "@/lib/payments/checkout";
import { currentGateway } from "@/lib/payments/runtime";
import { BookShell } from "../booking-summary";

export const metadata: Metadata = { title: "Payment cancelled", robots: { index: false } };

export default function CancelledPage({ searchParams }: PageProps<"/book/cancelled">) {
  return (
    <BookShell>
      <Suspense fallback={<p className="text-muted">One moment…</p>}>
        <Cancelled searchParams={searchParams} />
      </Suspense>
    </BookShell>
  );
}

async function Cancelled({ searchParams }: Pick<PageProps<"/book/cancelled">, "searchParams">) {
  const id = (await searchParams).session_id;
  const booking =
    typeof id === "string" && id.startsWith("cs_") ? await cancelCheckout(getDb(), id, await currentGateway()) : null;
  return (
    <>
      <h1 className="text-3xl font-semibold text-navy">Payment cancelled</h1>
      <p className="text-muted">
        {booking?.status === "EXPIRED"
          ? "Nothing was charged and the dates are free again. You can pick dates and try again whenever you like."
          : "Nothing more was charged."}
      </p>
      <Link href="/" className="self-start rounded-full bg-navy px-6 py-3 font-semibold text-white">
        Back to the home
      </Link>
    </>
  );
}
