"use server";
// The host's buttons on a booking. Each checks the sign-in again: a server action is
// a public endpoint, whatever page shows it.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { approveBooking, cancelBooking, changeDates, declineBooking, type HostResult } from "@/lib/booking/host";
import { currentGateway } from "@/lib/payments/runtime";

export type ActionState = { error?: string };

/** What the booking page says after a decision went through (`?done=`). */
export type Done = "approved" | "declined" | "cancelled" | "refunded" | "dates";

const ERRORS: Record<string, string> = {
  NOT_FOUND: "That booking no longer exists.",
  WRONG_STATUS: "This booking changed meanwhile. Reload the page to see where it stands.",
  NO_PAYMENT: "This booking has no card payment on this site, so there is nothing to charge or refund here.",
  PAYMENTS_OFF: "Stripe isn’t connected. Connect it on the Connections page first.",
  BAD_AMOUNT: "Enter a refund amount between $0 and what the guest paid.",
  DATES_TAKEN: "Some of those nights are already booked or blocked.",
  BAD_DATES: "Check-out must be after check-in.",
  STRIPE_ERROR: "Stripe didn’t accept this. Nothing was changed. Try again in a minute",
};

// On success the page reloads with `?done=`: the buttons that ran the action are gone by
// then (the booking has a new status), so the message has to come from the page.
function finish(r: HostResult, code: string, done: Done): ActionState {
  const safe = /^[A-Z0-9-]{1,20}$/i.test(code) ? code : null;
  if (safe) revalidatePath(`/admin/bookings/${safe}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin");
  if (r.ok) redirect(safe ? `/admin/bookings/${safe}?done=${done}` : "/admin/bookings");
  const msg = ERRORS[r.error] ?? "Something went wrong.";
  return { error: r.error === "STRIPE_ERROR" && r.detail ? `${msg} (${r.detail})` : msg };
}

const field = (form: FormData, name: string, max = 500) =>
  String(form.get(name) ?? "")
    .trim()
    .slice(0, max);

export async function approveAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const r = await approveBooking(getDb(), field(form, "id", 40), await currentGateway());
  return finish(r, field(form, "code", 20), "approved");
}

export async function declineAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const r = await declineBooking(getDb(), field(form, "id", 40), await currentGateway(), field(form, "note"));
  return finish(r, field(form, "code", 20), "declined");
}

export async function cancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const dollars = field(form, "refund", 20).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(dollars)) return { error: ERRORS.BAD_AMOUNT };
  const cents = Math.round(Number(dollars) * 100);
  const r = await cancelBooking(getDb(), field(form, "id", 40), cents, await currentGateway(), field(form, "note"));
  return finish(r, field(form, "code", 20), cents > 0 ? "refunded" : "cancelled");
}

export async function changeDatesAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const r = await changeDates(
    getDb(),
    field(form, "id", 40),
    { checkIn: field(form, "checkIn", 10), checkOut: field(form, "checkOut", 10) },
    field(form, "note"),
  );
  return finish(r, field(form, "code", 20), "dates");
}
