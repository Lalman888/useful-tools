import { MarkdownStudio } from "@/components/MarkdownStudio";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Markdown to PDF · Useful Tools" };

export default function MarkdownPage() {
  return (
    <main className="mx-auto max-w-[1500px] px-5 py-8">
      <PageHeader
        title="Markdown to PDF"
        description="Write on the left, watch the typeset page on the right, and download a PDF with a cover, contents, headers and page numbers."
      />
      <MarkdownStudio />
    </main>
  );
}
