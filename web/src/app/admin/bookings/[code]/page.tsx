// One booking: guest, stay, money and the host's decisions (§7). Works on a phone too,
// for approving on the go.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { bookingDetail } from "@/lib/booking/host";
import { formatUsd } from "@/lib/money";
import type { QuoteLine } from "@/lib/pricing/quote";
import { formatDay, formatWhen, paymentText, REASON_LABEL, STATUS_LABEL } from "../labels";
import { DecisionForms } from "./decision-forms";

export const metadata: Metadata = { title: "Booking" };

const DONE: Record<string, string> = {
  approved: "Approved. The guest’s card has been charged and the stay is confirmed.",
  declined: "Declined. The guest’s card was released and the nights are free.",
  cancelled: "Cancelled. The nights are free.",
  refunded: "Cancelled. The refund goes back to the guest’s card; banks usually show it within 5–10 business days.",
  dates: "Dates changed. The price and payment were not changed.",
};

export default function BookingPage({ params, searchParams }: PageProps<"/admin/bookings/[code]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
      <Link href="/admin/bookings" className="text-sm font-semibold text-gulf-ink">
        ← Bookings
      </Link>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Detail({ params, searchParams }: Pick<PageProps<"/admin/bookings/[code]">, "params" | "searchParams">) {
  await requireAdmin();
  const { code } = await params;
  const done = (await searchParams).done;
  const doneText = typeof done === "string" ? DONE[done] : undefined;
  const row = await bookingDetail(getDb(), decodeURIComponent(code));
  if (!row) notFound();
  const b = row.booking;
  const label = STATUS_LABEL[b.status];
  const lines = ((b.quote as { lines?: QuoteLine[] } | null)?.lines ?? []) as QuoteLine[];
  const nights = Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86_400_000);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold text-navy">
          {b.guestName ?? "Guest"} <span className="text-lg font-normal text-muted">· {b.code}</span>
        </h1>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${label.tone}`}>{label.text}</span>
      </div>

      {doneText && (
        <p role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok-ink">
          {doneText}
        </p>
      )}
      {b.status === "AWAITING_APPROVAL" && b.approveBy && (
        <p className="rounded-xl bg-[#fdf3d7] px-4 py-3 text-sm text-[#7a5a00]">
          Decide by <strong>{formatWhen(b.approveBy)}</strong>. After that the request expires and the card is released.
        </p>
      )}
      {b.statusReason && <p className="text-sm text-muted">{REASON_LABEL[b.statusReason]}</p>}

      <DecisionForms
        key={`${b.status}-${b.checkIn}-${b.checkOut}`}
        id={b.id}
        code={b.code}
        status={b.status}
        totalCents={b.totalCents}
        refundedCents={b.refundedCents}
        isWeb={b.source === "WEB"}
        checkIn={b.checkIn}
        checkOut={b.checkOut}
      />

      <section className="grid gap-4 sm:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-5 gap-y-2 rounded-2xl bg-wall p-5 text-sm">
          <dt className="text-muted">Home</dt>
          <dd>{row.homeName}</dd>
          <dt className="text-muted">Stay</dt>
          <dd>
            {formatDay(b.checkIn)} → {formatDay(b.checkOut)} ({nights} night{nights === 1 ? "" : "s"})
          </dd>
          <dt className="text-muted">Guests</dt>
          <dd>
            {b.guests}
            {b.pets > 0 ? `, ${b.pets} pet${b.pets === 1 ? "" : "s"}` : ""}
          </dd>
          <dt className="text-muted">Source</dt>
          <dd>{b.source === "WEB" ? "This website" : b.source === "AIRBNB" ? "Airbnb" : "Entered by hand"}</dd>
          <dt className="text-muted">Requested</dt>
          <dd>{formatWhen(b.createdAt)}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-5 gap-y-2 rounded-2xl bg-wall p-5 text-sm">
          <dt className="text-muted">Email</dt>
          <dd className="break-all">
            {b.guestEmail ? (
              <a className="text-gulf-ink underline" href={`mailto:${b.guestEmail}?subject=Your stay (${b.code})`}>
                {b.guestEmail}
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-muted">Phone</dt>
          <dd>
            {b.guestPhone ? (
              <a className="text-gulf-ink underline" href={`tel:${b.guestPhone.replace(/[^\d+]/g, "")}`}>
                {b.guestPhone}
              </a>
            ) : (
              "—"
            )}
          </dd>
          {b.message && (
            <>
              <dt className="text-muted">Message</dt>
              <dd className="whitespace-pre-wrap">{b.message}</dd>
            </>
          )}
          {b.hostNote && (
            <>
              <dt className="text-muted">Your note</dt>
              <dd className="whitespace-pre-wrap">{b.hostNote}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-[#dbe2e8] p-5 text-sm">
        <h2 className="text-lg font-semibold text-navy">Payment</h2>
        <p>{paymentText(b)}</p>
        {lines.length > 0 && (
          <table className="w-full">
            <tbody>
              {lines.map((l) => (
                <tr key={`${l.code}-${l.label}`} className="border-t border-[#eef1f2]">
                  <td className="py-1.5">{l.label}</td>
                  <td className="py-1.5 text-right">{formatUsd(l.amountCents)}</td>
                </tr>
              ))}
              {b.totalCents !== null && (
                <tr className="border-t border-[#c9d3dc] font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right">{formatUsd(b.totalCents)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {b.policyVersion && <p className="text-muted">Guest accepted policies version {b.policyVersion}.</p>}
        {b.stripePaymentIntentId && <p className="font-mono text-xs text-muted">Stripe: {b.stripePaymentIntentId}</p>}
      </section>
    </>
  );
}
