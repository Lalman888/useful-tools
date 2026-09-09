export type UploadSettings = {
  expiresInHours: number | null;
  maxDownloads: number | null;
  password: string | null;
  /** Set when the file is being sent to somebody else's request link. */
  requestId?: string;
  /** Who the file is from, as typed by the sender. */
  submitter?: string;
};

export type UploadProgress = {
  uploaded: number;
  total: number;
  bytesPerSecond: number;
};

const MAX_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Uploads a file in chunks, resuming from the server's stored offset if a
 * chunk fails. Nothing is held in memory beyond the chunk in flight, so the
 * size of the file is bounded only by the server's disk.
 */
export async function uploadFile(
  file: File,
  settings: UploadSettings,
  onProgress: (progress: UploadProgress) => void,
  signal: AbortSignal
): Promise<{ id: string; deleteToken?: string }> {
  const initResponse = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type,
      expiresInHours: settings.expiresInHours,
      maxDownloads: settings.maxDownloads,
      password: settings.password,
      requestId: settings.requestId,
      submitter: settings.submitter,
    }),
    signal,
  });
  if (!initResponse.ok) {
    throw new Error(await readError(initResponse, "Could not start the upload."));
  }
  // No delete token comes back for a submission: giving a file away is not
  // meant to be undoable by the sender.
  const { id, chunkSize, deleteToken } = (await initResponse.json()) as {
    id: string;
    chunkSize: number;
    deleteToken?: string;
  };

  let offset = 0;
  const startedAt = Date.now();

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    let attempt = 0;

    for (;;) {
      if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      try {
        const response = await fetch(
          `/api/upload/chunk?id=${id}&offset=${offset}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file.slice(offset, end),
            signal,
          }
        );

        if (response.status === 409) {
          // The server and client disagree about how much has landed; adopt
          // the server's view and carry on from there.
          const synced = (await response.json()) as { offset?: number };
          if (typeof synced.offset === "number") {
            offset = synced.offset;
            break;
          }
        }
        if (!response.ok) {
          throw new Error(await readError(response, "Chunk upload failed."));
        }

        const { offset: next } = (await response.json()) as { offset: number };
        offset = next;
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        attempt++;
        if (attempt >= MAX_ATTEMPTS) throw error;
        // Back off, then resynchronise with whatever the server actually holds.
        await sleep(2 ** attempt * 250);
        try {
          const status = await fetch(`/api/upload/chunk?id=${id}`, { signal });
          if (status.ok) {
            const { offset: stored } = (await status.json()) as { offset: number };
            offset = stored;
          }
        } catch {
          /* the retry below will surface a persistent failure */
        }
      }
    }

    const elapsed = (Date.now() - startedAt) / 1000;
    onProgress({
      uploaded: offset,
      total: file.size,
      bytesPerSecond: elapsed > 0 ? offset / elapsed : 0,
    });
  }

  const completeResponse = await fetch(`/api/upload/complete?id=${id}`, {
    method: "POST",
    signal,
  });
  if (!completeResponse.ok) {
    throw new Error(await readError(completeResponse, "Could not finalise the upload."));
  }

  return { id, deleteToken };
}
