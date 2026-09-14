/**
 * Build-time room server setting (`VITE_ROOM_SERVER_URL`).
 * Unset, empty or invalid: no online play. `same-origin`: the page's own server. Otherwise an http(s) URL.
 */
export function resolveRoomServer(setting: string | undefined): { url?: string } | null {
  const value = setting?.trim();
  if (!value) return null;
  if (value === 'same-origin') return {};
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? { url: url.href } : null;
  } catch { return null; }
}
