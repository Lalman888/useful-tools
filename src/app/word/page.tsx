import { WordViewer } from "@/components/WordViewer";
import { PageHeader } from "@/components/ui";

import type { Metadata } from "next";
import { toolByHref } from "@/lib/site";

const tool = toolByHref("/word")!;

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

export default function WordPage() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-5 py-10">
      <PageHeader
        title="Word viewer"
        description="Open a .docx and read it without Word installed. The file is parsed in your browser, so it is never uploaded — and you can take it straight out as Markdown or a typeset PDF."
      />
      <WordViewer />
    </main>
  );
}
