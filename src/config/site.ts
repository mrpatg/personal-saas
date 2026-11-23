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
  /** One-line summary used in meta tags and as the home page subheading. */
  tagline: string;
  /** One line on what the business does. */
  description: string;
  /** Public contact address shown to clients. */
  contactEmail: string;
  /**
   * Theme colors (any CSS color). They become CSS variables and Tailwind
   * colors: `bg-primary`, `text-primary-foreground`, `bg-canvas`, `text-ink`.
   * Lighter tints are derived automatically, e.g. `bg-primary/10`.
   */
  colors: {
    /** Main brand color: buttons, links, logo. */
    primary: string;
    /** Text shown on top of the primary color. */
    primaryForeground: string;
    /** Page background (a soft off-white reads more upscale than pure white). */
    canvas: string;
    /** Main text color. */
    ink: string;
  };
  /** Main navigation links. */
  nav: NavLink[];
  /** The highlighted button in the header. */
  cta: NavLink;
  /** Public home page copy. */
  home: {
    eyebrow: string;
    headline: string;
    intro: string;
    highlights: { title: string; body: string }[];
  };
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
    primary: '#1f4d3a', // forest green
    primaryForeground: '#f7f5ef',
    canvas: '#f6f4ee', // warm ivory
    ink: '#1b2420',
  },
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Contact', href: `mailto:${contactEmail}` },
  ],
  cta: { label: 'Client login', href: '/login' },
  home: {
    eyebrow: 'Patrick Godbey · Software consulting',
    headline: 'Your project, clearly in view.',
    intro:
      'Software development consulting for the people making technology decisions. Follow progress, keep conversations in one place, and pay invoices online.',
    highlights: [
      { title: 'Less back and forth', body: 'Status, decisions and files live in one place instead of long email threads.' },
      { title: 'More clarity', body: 'See every project, task and milestone, and exactly where it stands.' },
      { title: 'Simple billing', body: 'Clear invoices you can review and pay online in a minute.' },
    ],
  },
};
