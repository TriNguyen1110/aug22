'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  NavbarMenu,
  NavbarMenuItem,
  Link,
} from '@heroui/react';
import { Compass, Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { href: '/trends', label: 'Trends' },
  { href: '/competitors', label: 'Competitors' },
  { href: '/monitoring', label: 'Monitoring' },
];

export function SiteNav() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <Navbar
      isBordered
      maxWidth="xl"
      isMenuOpen={isMenuOpen}
      onMenuOpenChange={setIsMenuOpen}
      className="border-b border-silver/10 bg-ink/80 backdrop-blur-md"
    >
      <NavbarContent justify="start">
        <NavbarBrand>
          <Link href="/" color="foreground" className="flex items-center gap-2.5">
            <Compass className="h-5 w-5 shrink-0 text-teal" strokeWidth={1.6} />
            <span className="font-display text-lg font-semibold leading-none tracking-wide text-[#e9edeb]">
              Meridian
            </span>
          </Link>
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent justify="end" className="hidden gap-8 sm:flex">
        {NAV_LINKS.map((link) => (
          <NavbarItem key={link.href}>
            <Link
              href={link.href}
              className={`border-b-2 pb-0.5 text-sm font-medium tracking-wide transition-colors ${
                isActive(link.href)
                  ? 'border-teal text-teal'
                  : 'border-transparent text-silver hover:text-teal'
              }`}
            >
              {link.label}
            </Link>
          </NavbarItem>
        ))}
      </NavbarContent>

      <NavbarContent justify="end" className="sm:hidden">
        <button
          type="button"
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setIsMenuOpen((open) => !open)}
          className="flex h-6 w-6 items-center justify-center text-silver"
        >
          {isMenuOpen ? <X className="h-5 w-5" strokeWidth={1.8} /> : <Menu className="h-5 w-5" strokeWidth={1.8} />}
        </button>
      </NavbarContent>

      <NavbarMenu className="bg-ink/95">
        {NAV_LINKS.map((link) => (
          <NavbarMenuItem key={link.href}>
            <Link
              href={link.href}
              className={`w-full text-base font-medium tracking-wide ${
                isActive(link.href) ? 'text-teal' : 'text-silver'
              }`}
              onPress={() => setIsMenuOpen(false)}
            >
              {link.label}
            </Link>
          </NavbarMenuItem>
        ))}
      </NavbarMenu>
    </Navbar>
  );
}
