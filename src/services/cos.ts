import type { BriefConfig } from "../types";
import { buildDetailedReportObjectKey } from "../lib/report";

const SIGN_VALID_SECONDS = 3600;

export async function uploadDetailedReportToCos(
  config: BriefConfig,
  content: string,
  now = new Date()
): Promise<{ key: string; url: string }> {
  const key = buildDetailedReportObjectKey(now);
  const baseUrl = config.cosBaseUrl.replace(/\/+$/, "");
  const objectUrl = `${baseUrl}/${key}`;
  const url = new URL(objectUrl);
  const contentType = "text/markdown; charset=utf-8";
  const date = now.toUTCString();
  const signedHeaders = new Map<string, string>([
    ["content-type", contentType],
    ["date", date],
    ["host", url.host]
  ]);
  const authorization = await buildCosAuthorization(config, "put", url.pathname, signedHeaders, now);

  const response = await fetch(objectUrl, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      Date: date,
      "Content-Type": contentType
    },
    body: content
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`COS upload HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  return { key, url: objectUrl };
}

async function buildCosAuthorization(
  config: BriefConfig,
  method: string,
  pathname: string,
  headers: Map<string, string>,
  now: Date
): Promise<string> {
  const start = Math.floor(now.getTime() / 1000);
  const end = start + SIGN_VALID_SECONDS;
  const keyTime = `${start};${end}`;
  const signKey = await hmacSha1Hex(config.cosSecretKey, keyTime);

  const headerEntries = [...headers.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const headerList = headerEntries.map(([key]) => key).join(";");
  const httpHeaders = headerEntries.map(([key, value]) => `${encodeCos(key)}=${encodeCos(value)}`).join("&");
  const httpString = `${method.toLowerCase()}\n${pathname}\n\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(httpString)}\n`;
  const signature = await hmacSha1Hex(signKey, stringToSign);

  return `q-sign-algorithm=sha1&q-ak=${config.cosSecretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return toHex(digest);
}

async function hmacSha1Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return toHex(signature);
}

function toHex(data: ArrayBuffer): string {
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeCos(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
