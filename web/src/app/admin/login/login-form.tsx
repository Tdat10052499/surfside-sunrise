"use client";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { signIn, type FormState } from "../actions";
import { buttonClass, FormError, inputClass } from "../auth-shell";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          className={inputClass}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${inputClass} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-pressed={show}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-2 -translate-y-1/2 px-2 py-1 text-sm font-semibold text-gulf-ink"
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-sm text-muted">
        Forgot your password? Ask the site team to reset it for now; email reset comes with the email step.
      </p>
    </form>
  );
}
