import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" lede="Only the host’s admin account can sign in. Guests don’t need an account.">
      {/* The form reads ?next= from the URL, which is only known at request time. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
