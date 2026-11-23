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
  /** The business behind the site. Shown in the header, footer and page titles. */
  owner: string;
  /** Short monogram (1–3 letters) used as the header logo and favicon. */
  monogram: string;
  /** What this app is called, e.g. "Client Portal". Shown next to the owner. */
  name: string;
  /** One line on what the business does, shown on the home page. */
  description: string;
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

const contactEmail = 'patrick@patrickgodbey.com';

export const site: SiteConfig = {
  owner: 'Patrick Godbey',
  monogram: 'PG',
  name: 'Client Portal',
  tagline: 'Project progress, conversations and invoices, all in one place.',
  description: 'Software development consulting for the people making technology decisions.',
  contactEmail,
  colors: {
    brand: '#1e293b', // slate-800
    brandForeground: '#ffffff',
    accent: '#2563eb', // blue-600
  },
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Contact', href: `mailto:${contactEmail}` },
  ],
};
