// Placeholder dashboard until the admin screens are built (plan step 8). It proves the
// guard: only a signed-in admin who has replaced the temporary password gets here.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth/session";
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
  return (
    <>
      {changed && (
        <p role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok-ink">
          Password saved. Other devices were signed out.
        </p>
      )}
      <h1 className="text-3xl font-semibold text-navy">Signed in as {admin.email}</h1>
      <p className="text-muted">Bookings, calendar and prices arrive here in the next steps.</p>
      <div className="flex flex-wrap gap-3">
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
            className="rounded-full bg-navy px-5 py-2.5 font-semibold text-white hover:bg-[#17283f]"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
