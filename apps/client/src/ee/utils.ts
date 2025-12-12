import { getServerAppUrl, getSubdomainHost } from "@/lib/config.ts";

export function getHostnameUrl(hostname: string): string {
  const url = new URL(getServerAppUrl());
  const isHttps = url.protocol === "https:";
  
  // Get port from current window location (includes port if present)
  const currentPort = window.location.port;
  const port = currentPort ? `:${currentPort}` : "";

  const protocol = isHttps ? "https" : "http";
  return `${protocol}://${hostname}.${getSubdomainHost()}${port}`;
}

export function exchangeTokenRedirectUrl(
  hostname: string,
  exchangeToken: string,
) {
  return getHostnameUrl(hostname) + "/api/auth/exchange?token=" + exchangeToken;
}
