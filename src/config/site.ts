/**
 * Site configuration — the ONLY place business-specific details live.
 *
 * To reuse this codebase for a new SaaS, edit this file (and the Worker /
 * database names in wrangler.jsonc). Pages, layouts and components must read
 * names, copy and colors from here instead of hardcoding them.
 */

export interface NavLink {
  label: string;
  href: string;
}

export interface SiteConfig {
  /** Shown in the header, page titles and emails. */
  name: string;
  /** One-line description used on the home page and in meta tags. */
  tagline: string;
  /** Public contact address shown to clients. */
  contactEmail: string;
  /**
   * Brand colors as CSS colors. They become CSS variables and Tailwind
   * colors: `bg-brand`, `text-brand-accent`, etc.
   */
  colors: {
    brand: string;
    brandForeground: string;
    accent: string;
  };
  /** Main navigation links. */
  nav: NavLink[];
}

export const site: SiteConfig = {
  name: 'Client Portal',
  tagline: 'Projects, tasks and invoices in one place.',
  contactEmail: 'hello@example.com',
  colors: {
    brand: '#1e293b', // slate-800
    brandForeground: '#ffffff',
    accent: '#2563eb', // blue-600
  },
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Contact', href: 'mailto:hello@example.com' },
  ],
};
