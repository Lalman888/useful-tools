import { notFound } from "next/navigation";
import { LiveTextViewer } from "@/components/LiveTextViewer";
import { isValidId } from "@/lib/storage";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared text",
  // The link is the only thing protecting the text, so it must never be
  // indexed, followed or previewed anywhere.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function SharedTextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidId(id)) notFound();

  return (
    <main id="main" className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="mb-1.5 text-2xl font-semibold tracking-tight text-slate-900">
        Shared text
      </h1>
      <p className="mb-6 text-sm text-slate-600">
        This updates by itself as the person sharing it types.
      </p>
      <LiveTextViewer id={id} />
    </main>
  );
}
