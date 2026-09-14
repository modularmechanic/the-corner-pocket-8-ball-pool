const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/**
 * Build-time room server setting (`VITE_ROOM_SERVER_URL`).
 * Unset, empty or invalid: no online play. `same-origin`: the page's own server.
 * Otherwise an https origin (plain http only for localhost, since HTTPS pages block mixed content).
 */
export function resolveRoomServer(setting: string | undefined): { url?: string } | null {
  const value = setting?.trim();
  if (!value) return null;
  if (value === 'same-origin') return {};
  try {
    const url = new URL(value);
    // Socket.IO reads a URL path as a namespace, so only the origin is kept.
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
      ? { url: url.origin }
      : null;
  } catch {
    return null;
  }
}
