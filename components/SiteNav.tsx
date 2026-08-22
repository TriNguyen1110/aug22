'use client';

import { Navbar, NavbarBrand, NavbarContent, NavbarItem, Link } from '@heroui/react';

export function SiteNav() {
  return (
    <Navbar
      isBordered
      maxWidth="xl"
      className="bg-white/80 backdrop-blur"
    >
      <NavbarBrand>
        <Link href="/" color="foreground" className="font-bold text-lg">
          Notion Market Watch
        </Link>
      </NavbarBrand>
      <NavbarContent justify="end" className="gap-6">
        <NavbarItem>
          <Link href="/trends" color="foreground" className="text-sm font-medium">
            Trends
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link href="/competitors" color="foreground" className="text-sm font-medium">
            Competitors
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link href="/monitoring" color="foreground" className="text-sm font-medium">
            Monitoring
          </Link>
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
