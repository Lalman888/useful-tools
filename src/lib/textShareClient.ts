/**
 * Browser side of live text sharing.
 *
 * The WebSocket carries the live stream; the HTTP snapshot is what a viewer
 * sees first and what they fall back to when the socket cannot be reached at
 * all — on a host with no long-running process to hold one open, or behind a
 * proxy that strips upgrades. Falling back to polling means the link still
 * works there, just a few seconds behind instead of instantly.
 */

export type HostMessage =
  | { type: "hosting"; watchers: number }
  | { type: "watchers"; count: number }
  | { type: "taken-over" }
  | { type: "error"; error: string };

export type WatchMessage =
  | { type: "text"; text: string; live: boolean }
  | { type: "host-left" }
  | { type: "stopped" }
  | { type: "error"; error: string };

export function textSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/text`;
}

export function shareUrl(id: string): string {
  return `${window.location.origin}/t/${id}`;
}

/** How long to wait before giving up on the socket and polling instead. */
export const SOCKET_TIMEOUT_MS = 4000;

/** How often to poll the snapshot when there is no socket. */
export const POLL_INTERVAL_MS = 3000;

/**
 * Opens the socket, or rejects once it is clear it is not going to open. A
 * WebSocket that never connects otherwise sits in CONNECTING indefinitely.
 */
export function openTextSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(textSocketUrl());

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("timeout"));
    }, SOCKET_TIMEOUT_MS);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("unreachable"));
    };
  });
}

export function sendJson(socket: WebSocket | null, message: unknown): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
