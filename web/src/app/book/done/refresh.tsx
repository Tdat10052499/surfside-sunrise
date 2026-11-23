"use client";
// While Stripe's webhook hasn't arrived, look again every few seconds (for up to two
// minutes) so the guest sees the real outcome without reloading.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshWhilePending() {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 40) clearInterval(timer);
      else router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
