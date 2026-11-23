// Words the dashboard uses for booking states, shared by the list and the detail page.
import type { StatusReason } from "@/db/schema";
import { formatUsd } from "@/lib/money";

export const HOME_TZ = "America/Chicago"; // ASSUMPTION: the homes are in Texas

export const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  HOLD: { text: "Paying now", tone: "bg-wall text-muted" },
  AWAITING_APPROVAL: { text: "Needs your decision", tone: "bg-[#fdf3d7] text-[#7a5a00]" },
  CONFIRMED: { text: "Confirmed", tone: "bg-ok-bg text-ok-ink" },
  EXPIRED: { text: "Expired", tone: "bg-wall text-muted" },
  REJECTED: { text: "Declined", tone: "bg-wall text-muted" },
  CANCELLED: { text: "Cancelled", tone: "bg-err-bg text-err-ink" },
  REFUNDED: { text: "Refunded", tone: "bg-err-bg text-err-ink" },
};

export const REASON_LABEL: Record<StatusReason, string> = {
  CHECKOUT_EXPIRED: "The guest didn’t finish paying.",
  PAYMENT_CANCELED: "The card authorisation was cancelled or ran out.",
  AMOUNT_MISMATCH: "Stripe authorised a different amount than the quote, so it was released automatically.",
  DATES_TAKEN: "The nights were booked by someone else before the payment arrived; the card was released.",
  APPROVAL_TIMEOUT: "Not answered before the deadline; the card was released.",
  HOST_DECLINED: "You declined it.",
  HOST_CANCELLED: "You cancelled it.",
};

export function paymentText(b: {
  source: string;
  status: string;
  totalCents: number | null;
  refundedCents: number;
  stripePaymentIntentId?: string | null;
}): string {
  if (b.source !== "WEB") return "Paid outside this site";
  const total = b.totalCents ?? 0;
  switch (b.status) {
    case "HOLD":
      return "Guest is on the payment page";
    case "AWAITING_APPROVAL":
      return `Card authorised for ${formatUsd(total)}, not charged yet`;
    case "CONFIRMED":
      return b.refundedCents
        ? `Charged ${formatUsd(total)}, ${formatUsd(b.refundedCents)} refunded`
        : `Charged ${formatUsd(total)}`;
    case "CANCELLED":
    case "REFUNDED":
      return `Charged ${formatUsd(total)}, ${formatUsd(b.refundedCents)} refunded`;
    default:
      return b.stripePaymentIntentId ? "Authorisation released, not charged" : "Not paid";
  }
}

export function formatWhen(d: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: HOME_TZ,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d) + " CT"
  );
}

export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
