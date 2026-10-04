import { LiveText } from "@/components/LiveText";
import { PageHeader } from "@/components/ui";
import { storageAvailable } from "@/lib/storage";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/text")!;

export const metadata: Metadata = {
  title: tool.name,
  description: tool.description,
  alternates: { canonical: tool.href },
  openGraph: {
    title: `${tool.name} · Useful Tools`,
    description: tool.description,
    url: tool.href,
  },
};

// Whether a session can be stored is a property of the running host, not of
// the build, so this page is rendered per request.
export const dynamic = "force-dynamic";

export default function TextPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-5 py-10">
      <PageHeader
        title="Live text"
        description="Paste anything and it comes back exactly as you pasted it — every space, tab and blank line intact, nothing reformatted or highlighted. Made bigger for reading off a screen, with an option to hide the values in an .env before you show it to anyone."
      />
      <LiveText canShare={storageAvailable()} />
    </main>
  );
}
