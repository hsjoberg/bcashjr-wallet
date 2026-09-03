const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;

export function resolveUiResource(uiRoot: URL, pathname: string): URL | null {
  if (ENCODED_SEPARATOR.test(pathname) || pathname.includes("\\")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\//u, "");
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const resource = new URL(segments.map(encodeURIComponent).join("/"), uiRoot);
  return resource.href.startsWith(uiRoot.href) ? resource : null;
}

export function createRpcCapability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function capabilityMatches(actual: string | null, expected: string): boolean {
  if (actual === null || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function browserListenPort(configuredPort: string | undefined): number {
  if (configuredPort === undefined) return 0;
  const port = Number(configuredPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function shouldUseUiIndexFallback(pathname: string): boolean {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//u, "");
  return !requested.includes(".");
}
