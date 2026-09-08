/** Wire format for everything that crosses the data channel before the bytes. */
export type PeerMessage =
  | { kind: "meta"; name: string; size: number; type: string }
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "done" };

/** 16 KiB is the largest message every browser accepts on a data channel. */
export const CHUNK_SIZE = 16 * 1024;

/** Pause sending once this much is queued, so we never balloon the send buffer. */
export const BUFFER_HIGH_WATER = 1024 * 1024;
export const BUFFER_LOW_WATER = 256 * 1024;

function iceServers(): RTCIceServer[] {
  const configured = process.env.NEXT_PUBLIC_STUN_URLS;
  const urls = configured
    ? configured.split(",").map((url) => url.trim()).filter(Boolean)
    : ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"];
  return [{ urls }];
}

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: iceServers() });
}

export function signalingUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/p2p`;
}

/**
 * Resolves once the channel's send buffer has drained below the low-water
 * mark. Without this a large file queues faster than it can be sent and the
 * tab's memory grows to the size of the file.
 */
export function waitForDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount < BUFFER_HIGH_WATER) return Promise.resolve();
  return new Promise((resolve) => {
    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    channel.addEventListener("bufferedamountlow", onLow);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
