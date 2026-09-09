import Link from "next/link";
import { SITE_NAME, TOOLS } from "@/lib/site";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
      <nav aria-label="Tools" className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="text-sm font-semibold tracking-tight text-slate-900">
          {SITE_NAME}
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {tool.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
