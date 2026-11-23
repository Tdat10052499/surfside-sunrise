// Two-column frame of the sign-in screens (prototype: AdminLogin, AdminReset).
import Image from "next/image";
import type { ReactNode } from "react";
import deck from "../../../public/img/deck-800.webp";

export function AuthShell({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen flex-1 grid-cols-1 min-[901px]:grid-cols-2">
      <div className="relative h-48 overflow-hidden bg-navy min-[901px]:h-auto">
        <Image
          src={deck}
          alt=""
          fill
          priority
          sizes="(min-width: 901px) 50vw, 100vw"
          className="object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(15,30,48,.15)] to-[rgba(15,30,48,.75)]" />
        <p className="absolute top-8 left-10 z-10 font-semibold text-white">Seathesunrise</p>
        <div className="absolute right-10 bottom-10 left-10 z-10 hidden flex-col gap-2 text-white min-[901px]:flex">
          <b className="text-2xl leading-tight font-semibold">Host dashboard</b>
          <span>Bookings, calendar, prices and messages for your homes.</span>
        </div>
      </div>
      <main className="flex items-start justify-center px-4 py-10 sm:px-8 min-[901px]:items-center">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <p className="text-sm font-semibold tracking-wider text-gulf-ink uppercase">Admin</p>
          <h1 className="text-3xl leading-tight font-semibold text-navy">{title}</h1>
          {lede && <div className="text-muted">{lede}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-[#c9d1d8] bg-wall px-3.5 py-3 text-base outline-none focus:border-gulf focus:ring-2 focus:ring-gulf/30";
export const buttonClass =
  "rounded-full bg-navy px-6 py-3 font-semibold text-white transition hover:bg-[#17283f] disabled:opacity-60";

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-3 text-sm text-err-ink">
      {message}
    </p>
  );
}
