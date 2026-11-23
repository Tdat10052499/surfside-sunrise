// Connections: the owner links outside services by pasting one key each. Stripe now;
// email (Resend) and status cards for the database, domain and hosting come later.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { stripeStatus } from "@/lib/payments/connection";
import { disconnectStripeAction } from "./actions";
import { StripeKeyForm } from "./stripe-key-form";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
      <Link href="/admin" className="text-sm font-semibold text-gulf-ink">
        ← Dashboard
      </Link>
      <h1 className="text-3xl font-semibold text-navy">Connections</h1>
      <p className="text-muted">Link the services the site runs on. Each needs one key, pasted once.</p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <StripeCard />
      </Suspense>
    </main>
  );
}

const PERMISSIONS = [
  ["Checkout Sessions", "Write"],
  ["PaymentIntents", "Write"],
  ["Refunds", "Write"],
  ["Webhook Endpoints", "Write"],
  ["Account", "Read (optional, shows your account name here)"],
];

async function StripeCard() {
  await requireAdmin();
  const status = await stripeStatus(getDb(), serverEnv());
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[#dbe2e8] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-navy">Stripe · card payments</h2>
        {status.connected ? (
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${status.livemode ? "bg-ok-bg text-ok-ink" : "bg-[#fdf3d7] text-[#7a5a00]"}`}
          >
            {status.livemode ? "Connected · Live" : "Connected · Test mode"}
          </span>
        ) : (
          <span className="rounded-full bg-err-bg px-3 py-1 text-sm font-semibold text-err-ink">Not connected</span>
        )}
      </div>

      {status.connected && status.source === "dashboard" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {status.accountName && (
            <>
              <dt className="text-muted">Account</dt>
              <dd>{status.accountName}</dd>
            </>
          )}
          <dt className="text-muted">Key</dt>
          <dd className="font-mono">{status.masked}</dd>
          <dt className="text-muted">Updates go to</dt>
          <dd className="break-all">{status.webhookUrl}</dd>
          <dt className="text-muted">Connected</dt>
          <dd>{status.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
        </dl>
      )}
      {status.connected && status.source === "env" && (
        <p className="text-sm text-muted">
          Using the site team’s development key ({status.masked}). Paste your own key below to take over.
        </p>
      )}

      <details className="rounded-xl bg-wall p-4 text-sm" open={!status.connected}>
        <summary className="cursor-pointer font-semibold text-navy">How to get the key</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5">
          <li>In Stripe, open Developers → API keys.</li>
          <li>Choose “Create restricted key”, name it “Seathesunrise website”.</li>
          <li>
            Give it these permissions and leave everything else at None:
            <ul className="mt-1 list-disc pl-5">
              {PERMISSIONS.map(([what, level]) => (
                <li key={what}>
                  {what}: {level}
                </li>
              ))}
            </ul>
          </li>
          <li>Create the key, copy it (it starts with rk_live_) and paste it below.</li>
        </ol>
        <p className="mt-3 text-muted">
          The site checks the key, sets up Stripe’s updates to this site by itself, and stores the key encrypted. Only
          its last 4 characters are ever shown again.
        </p>
      </details>

      <StripeKeyForm replacing={status.connected} />

      {status.connected && status.source === "dashboard" && (
        <form action={disconnectStripeAction}>
          <button type="submit" className="text-sm font-semibold text-err-ink underline underline-offset-4">
            Disconnect Stripe
          </button>
        </form>
      )}
    </section>
  );
}
