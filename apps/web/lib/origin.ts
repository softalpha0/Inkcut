/**
 * The public address of the site for building redirects. Behind a hosting proxy
 * (Render) `request.url` is the internal address (e.g. http://localhost:10000),
 * so prefer the forwarded host, then NEXT_PUBLIC_SITE_URL.
 */
export function publicOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${host}`;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (site) return site;
  return new URL(request.url).origin;
}
