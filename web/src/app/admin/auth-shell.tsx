// Two-column frame of the sign-in screens (prototype: AdminLogin, AdminReset).
// The left panel is a geometric "sunrise over the Gulf" built from CSS shapes
// (no image to download). Styles and the entrance animation: .auth-* in globals.css.
import type { CSSProperties, ReactNode } from "react";

type Tile = { area: string; shape: string; color: string; sun?: boolean };

// Grid areas on a 3 x 4 grid (desktop) and a 6 x 1 band (narrow screens).
const TILES: (Tile & { band: string })[] = [
  { area: "1 / 1 / 3 / 2", band: "1 / 1 / 2 / 2", shape: "pill", color: "navy" },
  { area: "1 / 2 / 2 / 3", band: "1 / 2 / 2 / 3", shape: "q-br", color: "gulf" },
  { area: "1 / 3 / 2 / 4", band: "1 / 3 / 2 / 4", shape: "arch", color: "navy" },
  { area: "2 / 2 / 3 / 4", band: "1 / 5 / 2 / 6", shape: "cap-l", color: "deck" },
  { area: "3 / 1 / 4 / 2", band: "1 / 6 / 2 / 7", shape: "q-tr", color: "navy" },
  { area: "3 / 2 / 4 / 3", band: "1 / 4 / 2 / 5", shape: "sky", color: "sky", sun: true },
  { area: "3 / 3 / 4 / 4", band: "", shape: "q-tl", color: "glass" },
  { area: "4 / 1 / 5 / 2", band: "", shape: "wave", color: "gulf" },
  { area: "4 / 2 / 5 / 3", band: "", shape: "wave", color: "navy" },
  { area: "4 / 3 / 5 / 4", band: "", shape: "wave", color: "gulf" },
];

function Mosaic() {
  return (
    <div className="auth-mosaic" aria-hidden="true">
      {TILES.map((t, i) => (
        <span
          key={i}
          className={`auth-tile auth-${t.shape} auth-c-${t.color}${t.band ? "" : " auth-tall-only"}`}
          style={{ "--area": t.area, "--band": t.band || "auto", "--i": i } as CSSProperties}
        >
          {t.sun && <i className="auth-sun" />}
        </span>
      ))}
    </div>
  );
}

export function AuthShell({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen flex-1 grid-cols-1 grid-rows-[auto_1fr] min-[901px]:grid-cols-2 min-[901px]:grid-rows-1">
      <div className="auth-panel">
        <p className="auth-word font-semibold text-navy">Seathesunrise</p>
        <Mosaic />
        <div className="auth-cap hidden flex-col gap-1 text-navy min-[901px]:flex">
          <b className="text-xl leading-tight font-semibold">Host dashboard</b>
          <span className="text-muted">Bookings, calendar, prices and messages for your homes.</span>
        </div>
      </div>
      <main className="flex items-start justify-center px-4 py-10 sm:px-8 min-[901px]:items-center">
        <div className="auth-form flex w-full max-w-sm flex-col gap-4">
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
