import { MarkdownPreview } from "@/components/MarkdownPreview";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Markdown preview · Useful Tools" };

export default function PreviewPage() {
  return (
    <main className="mx-auto max-w-[1500px] px-5 py-8">
      <PageHeader
        title="Markdown preview"
        description="Paste Markdown and read it rendered — just the document, with no cover page and no contents list."
      />
      <MarkdownPreview />
    </main>
  );
}
