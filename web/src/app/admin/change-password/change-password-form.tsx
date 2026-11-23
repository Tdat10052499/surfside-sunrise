"use client";
import { useActionState, useState } from "react";
import { passwordRules } from "@/lib/auth/password-rules";
import { updatePassword, type FormState } from "../actions";
import { buttonClass, FormError, inputClass } from "../auth-shell";

export function ChangePasswordForm({ currentLabel }: { currentLabel: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const rules = [
    ...passwordRules(password),
    { id: "repeat", text: "Both new passwords match", ok: repeat.length > 0 && repeat === password },
  ];
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {currentLabel}
        <input name="current" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-rules"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Repeat new password
        <input
          name="repeat"
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          className={inputClass}
        />
      </label>
      <ul id="password-rules" className="flex flex-col gap-1.5 text-sm">
        {rules.map((r) => (
          <li key={r.id} className={`flex items-center gap-2 ${r.ok ? "text-ok-ink" : "text-muted"}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 flex-none fill-none stroke-current stroke-2">
              <path d={r.ok ? "M20 6 9 17l-5-5" : "M12 12h.01"} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              {r.text}
              <span className="sr-only">{r.ok ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        ))}
      </ul>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
