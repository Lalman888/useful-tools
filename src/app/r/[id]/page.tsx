import { notFound } from "next/navigation";
import { RequestDropbox } from "@/components/RequestDropbox";
import { isValidId } from "@/lib/storage";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Send files",
  // A request link is handed to particular people; a crawler indexing it would
  // turn a private ask into an open drop box.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function RequestLandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidId(id)) notFound();

  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-10">
      <RequestDropbox id={id} />
    </main>
  );
}
