import Link from "next/link";

const LINKS = [
  { href: "/viewer", label: "Data viewer" },
  { href: "/markdown", label: "Markdown to PDF" },
  { href: "/pdf", label: "PDF toolkit" },
  { href: "/share", label: "Share a file" },
  { href: "/uploads", label: "My uploads" },
  { href: "/p2p", label: "Direct transfer" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="text-sm font-semibold tracking-tight text-slate-900">
          Useful Tools
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
