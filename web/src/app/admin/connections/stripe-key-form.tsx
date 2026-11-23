"use client";
import { useActionState } from "react";
import { buttonClass, FormError, inputClass } from "../auth-shell";
import { connectStripeAction, type ConnectState } from "./actions";

export function StripeKeyForm({ replacing }: { replacing: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectStripeAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {replacing ? "Replace with a new key" : "Stripe key"}
        <input
          name="key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="rk_live_…"
          required
          className={`${inputClass} font-mono`}
        />
      </label>
      <FormError message={state.error} />
      {state.ok && (
        <p role="status" className="rounded-xl bg-ok-bg px-3.5 py-3 text-sm text-ok-ink">
          Stripe is connected.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonClass} self-start`}>
        {pending ? "Checking with Stripe…" : "Connect"}
      </button>
    </form>
  );
}
