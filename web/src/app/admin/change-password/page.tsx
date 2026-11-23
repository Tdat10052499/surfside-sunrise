import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth/session";
import { AuthShell } from "../auth-shell";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default function ChangePasswordPage() {
  return (
    <Suspense>
      <ChangePassword />
    </Suspense>
  );
}

async function ChangePassword() {
  const admin = await requireAdmin({ allowPasswordChange: true });
  return admin.mustChangePassword ? (
    <AuthShell
      title="Choose your own password"
      lede={
        <>
          You signed in to <b className="text-navy">{admin.email}</b> with a temporary password. Set your own before you
          continue; the temporary one stops working.
        </>
      }
    >
      <ChangePasswordForm currentLabel="Temporary password" />
    </AuthShell>
  ) : (
    <AuthShell
      title="Change password"
      lede={<>For {admin.email}. You’ll stay signed in here and be signed out on other devices.</>}
    >
      <ChangePasswordForm currentLabel="Current password" />
    </AuthShell>
  );
}
