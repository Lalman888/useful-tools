import Link from "next/link";
import { SITE_NAME, TOOLS } from "@/lib/site";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
      {/* Wraps rather than scrolls: a clipped row gives no sign that there is
          anything past the edge, and the last tool simply disappeared. */}
      <nav
        aria-label="Tools"
        className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2"
      >
        <Link href="/" className="text-sm font-semibold tracking-tight text-slate-900">
          {SITE_NAME}
        </Link>
        <div className="flex flex-wrap items-center gap-1">
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
