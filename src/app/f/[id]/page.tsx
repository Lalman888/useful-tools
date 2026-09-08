import { notFound } from "next/navigation";
import { FileLanding } from "@/components/FileLanding";
import { isValidId } from "@/lib/storage";

export const metadata = { title: "Shared file · Useful Tools" };

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidId(id)) notFound();

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <FileLanding id={id} />
    </main>
  );
}
