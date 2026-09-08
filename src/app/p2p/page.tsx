import { PeerTransfer } from "@/components/PeerTransfer";
import { Alert, PageHeader } from "@/components/ui";

export const metadata = { title: "Direct transfer · Useful Tools" };

export default async function P2pPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.toUpperCase().slice(0, 6) : undefined;
  // server.mjs sets this; without it the /ws/p2p endpoint is not being served.
  const signalling = process.env.HAS_SIGNALING === "1";

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Direct transfer"
        description="Send a file straight from one browser to another. The server only introduces the two sides; the bytes never pass through it, so nothing limits how large the file can be."
      />
      {signalling ? (
        <PeerTransfer initialCode={initialCode} />
      ) : (
        <div className="mx-auto max-w-2xl">
          <Alert tone="warn">
            <p className="font-medium">Direct transfer is switched off on this deployment.</p>
            <p className="mt-1.5">
              Introducing two browsers to each other needs a WebSocket connection held
              open by a long-running server. Serverless functions cannot hold one, so
              this page has nothing to connect to. Run the app with its own server
              (<code className="rounded bg-white/60 px-1 py-0.5 text-xs">npm start</code>)
              on a host that supports WebSockets to turn it on.
            </p>
          </Alert>
        </div>
      )}
    </main>
  );
}
