// All bookings, with requests that need a decision first (§7).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { expireOverdueApprovals, listBookings, type BookingFilter } from "@/lib/booking/host";
import { formatUsd } from "@/lib/money";
import { currentGateway } from "@/lib/payments/runtime";
import { localToday } from "@/lib/public/homes";
import { formatDay, formatWhen, HOME_TZ, STATUS_LABEL } from "./labels";

export const metadata: Metadata = { title: "Bookings" };

const TABS: [BookingFilter, string][] = [
  ["awaiting", "Needs your decision"],
  ["upcoming", "Upcoming"],
  ["all", "All"],
];

export default function BookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
      <Link href="/admin" className="text-sm font-semibold text-gulf-ink">
        ← Dashboard
      </Link>
      <h1 className="text-3xl font-semibold text-navy">Bookings</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <List searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function List({ searchParams }: Pick<PageProps<"/admin/bookings">, "searchParams">) {
  await requireAdmin();
  const show = (await searchParams).show;
  const filter: BookingFilter = show === "upcoming" || show === "all" ? show : "awaiting";
  const db = getDb();
  // The daily job also does this; doing it here means the host never sees a stale request.
  await expireOverdueApprovals(db, await currentGateway());
  const rows = await listBookings(db, filter, localToday(HOME_TZ, new Date()));

  return (
    <>
      <nav className="flex flex-wrap gap-2" aria-label="Filter bookings">
        {TABS.map(([key, text]) => (
          <Link
            key={key}
            href={`/admin/bookings?show=${key}`}
            aria-current={key === filter ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${key === filter ? "bg-navy text-white" : "border border-[#c9d3dc] text-navy hover:bg-wall"}`}
          >
            {text}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-wall p-6 text-muted">
          {filter === "awaiting" ? "No requests waiting for you." : "No bookings here yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#dbe2e8]">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-wall text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Guest</th>
                <th className="px-4 py-3 font-semibold">Stay</th>
                <th className="px-4 py-3 font-semibold">Home</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const label = STATUS_LABEL[r.status];
                return (
                  <tr key={r.id} className="border-t border-[#eef1f2] hover:bg-wall">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/bookings/${r.code}`}
                        className="font-semibold text-navy underline-offset-2 hover:underline"
                      >
                        {r.guestName ?? "Guest"}
                      </Link>
                      <div className="text-xs text-muted">{r.code}</div>
                    </td>
                    <td className="px-4 py-3">
                      {formatDay(r.checkIn)} → {formatDay(r.checkOut)}
                      <div className="text-xs text-muted">
                        {r.guests} guest{r.guests === 1 ? "" : "s"}
                        {r.pets > 0 ? `, ${r.pets} pet${r.pets === 1 ? "" : "s"}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">{r.homeName}</td>
                    <td className="px-4 py-3 text-right">{r.totalCents !== null ? formatUsd(r.totalCents) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${label.tone}`}>
                        {label.text}
                      </span>
                      {r.status === "AWAITING_APPROVAL" && r.approveBy && (
                        <div className="mt-1 text-xs text-muted">by {formatWhen(r.approveBy)}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
