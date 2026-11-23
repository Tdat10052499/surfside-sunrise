// Runs once when a server instance starts. A missing or malformed secret stops the
// server here, with the variable's name, instead of failing later inside a request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("@/lib/env");
    serverEnv();
  }
}
