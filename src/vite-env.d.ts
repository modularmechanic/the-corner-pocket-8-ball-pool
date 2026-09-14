/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Unset or empty hides online play; `same-origin` or an http(s) URL names the room server. */
  readonly VITE_ROOM_SERVER_URL?: string;
}
