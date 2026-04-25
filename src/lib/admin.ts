export function readBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function authorizeAdminRequest(request: Request, expectedToken: string): { ok: true; status: 200 } | { ok: false; status: 401 | 403; error: string } {
  const actual = readBearerToken(request);
  if (!actual) {
    return { ok: false, status: 401, error: "missing bearer token" };
  }
  if (!expectedToken) {
    return { ok: false, status: 403, error: "manual trigger token is not configured" };
  }
  if (actual !== expectedToken) {
    return { ok: false, status: 403, error: "invalid bearer token" };
  }
  return { ok: true, status: 200 };
}
