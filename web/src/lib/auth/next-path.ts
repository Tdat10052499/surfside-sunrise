/** Where to go after signing in: only a path inside /admin, never another site. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/admin";
  if (!/^\/admin(\/[\w\-/]*)?(\?[\w\-=&%]*)?$/.test(next) || next.startsWith("/admin/login")) return "/admin";
  return next;
}
