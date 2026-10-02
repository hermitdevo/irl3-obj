"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "./logo";

const LINKS = [
  { href: "/", label: "Scan the World" },
  { href: "/library", label: "Object Library" },
];

/** The Scan link is lit on / only; the library on /library and below. */
const active = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 flex h-[var(--header-height)] items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <Link href="/" className="flex items-center gap-2.5">
        <Logo size={26} />
        <span className="text-sm font-semibold tracking-tight">IRL3 Objects</span>
      </Link>
      <nav className="ml-2 flex items-center gap-1 sm:ml-6">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active(pathname, l.href) ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              active(pathname, l.href) ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <a
        href="https://irl3.tech"
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto hidden items-center gap-1 text-sm text-muted transition-colors hover:text-foreground sm:flex"
      >
        irl3.tech <ArrowUpRight size={14} />
      </a>
    </header>
  );
}
