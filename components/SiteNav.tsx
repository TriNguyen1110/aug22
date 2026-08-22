'use client';

import { Navbar, NavbarBrand, NavbarContent, NavbarItem, Link } from '@heroui/react';
import { Compass } from 'lucide-react';

export function SiteNav() {
  return (
    <Navbar
      isBordered
      maxWidth="xl"
      className="border-b border-silver/10 bg-ink/80 backdrop-blur-md"
    >
      <NavbarBrand>
        <Link href="/" color="foreground" className="flex items-center gap-2.5">
          <Compass className="h-5 w-5 text-teal" strokeWidth={1.6} />
          <span className="font-display text-lg font-semibold tracking-wide text-[#e9edeb]">
            Notion Market Watch
          </span>
        </Link>
      </NavbarBrand>
      <NavbarContent justify="end" className="gap-8">
        <NavbarItem>
          <Link
            href="/trends"
            className="text-sm font-medium tracking-wide text-silver transition-colors hover:text-teal"
          >
            Trends
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link
            href="/competitors"
            className="text-sm font-medium tracking-wide text-silver transition-colors hover:text-teal"
          >
            Competitors
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link
            href="/monitoring"
            className="text-sm font-medium tracking-wide text-silver transition-colors hover:text-teal"
          >
            Monitoring
          </Link>
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
