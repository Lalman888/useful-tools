import { notFound } from "next/navigation";
import { FileLanding } from "@/components/FileLanding";
import { isValidId } from "@/lib/storage";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared file",
  // The link is the only thing protecting a shared file, so it must never be
  // indexed or followed, and no preview of it should be generated anywhere.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidId(id)) notFound();

  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <FileLanding id={id} />
    </main>
  );
}
