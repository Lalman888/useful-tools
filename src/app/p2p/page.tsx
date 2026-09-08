import { PeerTransfer } from "@/components/PeerTransfer";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Direct transfer · Useful Tools" };

export default async function P2pPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.toUpperCase().slice(0, 6) : undefined;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Direct transfer"
        description="Send a file straight from one browser to another. The server only introduces the two sides; the bytes never pass through it, so nothing limits how large the file can be."
      />
      <PeerTransfer initialCode={initialCode} />
    </main>
  );
}
