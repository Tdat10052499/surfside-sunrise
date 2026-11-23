// Dashboard overview (§7): requests waiting for a decision, stays starting soon, homes.
// Only a signed-in admin who has replaced the temporary password gets here.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { overview } from "@/lib/booking/host";
import { localToday } from "@/lib/public/homes";
import { HOME_TZ } from "./bookings/labels";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminHome({ searchParams }: PageProps<"/admin">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
      <p className="text-sm font-semibold tracking-wider text-gulf-ink uppercase">Seathesunrise admin</p>
      <Suspense fallback={<p className="text-muted">Checking your sign-in…</p>}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const admin = await requireAdmin();
  const changed = (await searchParams).password === "changed";
  const counts = await overview(getDb(), localToday(HOME_TZ, new Date()));
  const cards: [string, number, string, string][] = [
    [
      "Needs your decision",
      counts.awaiting,
      "/admin/bookings?show=awaiting",
      counts.awaiting ? "bg-[#fdf3d7]" : "bg-wall",
    ],
    ["Check-ins in the next 14 days", counts.upcoming, "/admin/bookings?show=upcoming", "bg-wall"],
    [`Homes (${counts.published} published)`, counts.homes, "/admin", "bg-wall"],
  ];
  return (
    <>
      {changed && (
        <p role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok-ink">
          Password saved. Other devices were signed out.
        </p>
      )}
      <h1 className="text-3xl font-semibold text-navy">Overview</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(([label, value, href, tone]) => (
          <Link
            key={label}
            href={href}
            className={`flex flex-col gap-1 rounded-2xl p-5 hover:ring-2 hover:ring-gulf ${tone}`}
          >
            <span className="text-3xl font-semibold text-navy">{value}</span>
            <span className="text-sm text-muted">{label}</span>
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted">Signed in as {admin.email}</p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/bookings"
          className="rounded-full bg-navy px-5 py-2.5 font-semibold text-white hover:bg-[#17283f]"
        >
          Bookings
        </Link>
        <Link
          href="/admin/connections"
          className="rounded-full border border-navy px-5 py-2.5 font-semibold text-navy hover:bg-wall"
        >
          Connections
        </Link>
        <Link
          href="/admin/change-password"
          className="rounded-full border border-navy px-5 py-2.5 font-semibold text-navy hover:bg-wall"
        >
          Change password
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-full border border-navy px-5 py-2.5 font-semibold text-navy hover:bg-wall"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
