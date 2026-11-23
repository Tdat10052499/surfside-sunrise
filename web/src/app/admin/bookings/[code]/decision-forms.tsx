"use client";
// The host's buttons. Each irreversible one asks once more in plain words before it
// runs. An error (e.g. Stripe's answer) shows in place; success reloads the page.
import { useActionState, useState, type ReactNode } from "react";
import { approveAction, cancelAction, changeDatesAction, declineAction, type ActionState } from "../actions";

type Props = {
  id: string;
  code: string;
  status: string;
  totalCents: number | null;
  refundedCents: number;
  isWeb: boolean;
  checkIn: string;
  checkOut: string;
};

const btn = "rounded-full px-5 py-2.5 font-semibold disabled:opacity-50";
const primary = `${btn} bg-navy text-white hover:bg-[#17283f]`;
const outline = `${btn} border border-navy text-navy hover:bg-wall`;
const danger = `${btn} bg-err-ink text-white hover:opacity-90`;
const input = "rounded-lg border border-[#c9d3dc] px-3 py-2";

function Result({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-xl bg-err-bg px-4 py-3 text-sm text-err-ink">
        {state.error}
      </p>
    );
  return null;
}

function Confirmable({
  label,
  style,
  question,
  action,
  hidden,
  children,
}: {
  label: string;
  style: string;
  question: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  children?: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 sm:items-start">
      {!open ? (
        <button type="button" className={style} onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <form action={run} className="flex flex-col gap-3 rounded-2xl border border-[#dbe2e8] p-4">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <p className="font-semibold text-navy">{question}</p>
          {children}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={style} disabled={pending}>
              {pending ? "Working…" : `Yes, ${label.toLowerCase()}`}
            </button>
            <button type="button" className={outline} onClick={() => setOpen(false)} disabled={pending}>
              Back
            </button>
          </div>
          <Result state={state} />
        </form>
      )}
    </div>
  );
}

const usd = (c: number) => (c / 100).toFixed(2);

export function DecisionForms(p: Props) {
  const hidden = { id: p.id, code: p.code };
  const note = (
    <label className="flex flex-col gap-1 text-sm">
      Note for your records (the guest doesn’t see it)
      <textarea name="note" rows={2} maxLength={500} className={input} />
    </label>
  );
  const refundable = Math.max(0, (p.totalCents ?? 0) - p.refundedCents);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
      {p.status === "AWAITING_APPROVAL" && (
        <>
          <Confirmable
            label="Approve"
            style={primary}
            question={`Charge the guest’s card${p.totalCents !== null ? ` $${usd(p.totalCents)}` : ""} and confirm the stay?`}
            action={approveAction}
            hidden={hidden}
          />
          <Confirmable
            label="Decline"
            style={outline}
            question="Decline this request? The card is released, the guest pays nothing and the nights become free."
            action={declineAction}
            hidden={hidden}
          >
            {note}
          </Confirmable>
        </>
      )}
      {p.status === "CONFIRMED" && (
        <Confirmable
          label="Cancel booking"
          style={danger}
          question="Cancel this stay? The nights become free. This can’t be undone."
          action={cancelAction}
          hidden={hidden}
        >
          <label className="flex flex-col gap-1 text-sm">
            Refund to the guest’s card, in USD (up to ${usd(refundable)})
            <input
              name="refund"
              inputMode="decimal"
              defaultValue={p.isWeb ? usd(refundable) : "0.00"}
              readOnly={!p.isWeb}
              className={`${input} max-w-40`}
            />
            {!p.isWeb && <span className="text-muted">Paid outside this site: refund the guest there.</span>}
          </label>
          {note}
        </Confirmable>
      )}
      {(p.status === "AWAITING_APPROVAL" || p.status === "CONFIRMED") && (
        <Confirmable
          label="Change dates"
          style={outline}
          question="Move this booking to other nights? The price and payment stay as they are."
          action={changeDatesAction}
          hidden={hidden}
        >
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex flex-col gap-1">
              Check-in
              <input type="date" name="checkIn" defaultValue={p.checkIn} required className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Check-out
              <input type="date" name="checkOut" defaultValue={p.checkOut} required className={input} />
            </label>
          </div>
          {note}
        </Confirmable>
      )}
    </div>
  );
}
