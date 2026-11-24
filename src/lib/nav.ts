import type { AppNavItem } from '../layouts/AppLayout.astro';

/** 24x24 outline icon paths for the signed-in navigation. */
const icons = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  clients: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6m13 9v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
};

/** Client area navigation. Invoices join when that feature lands. */
export const clientNav: AppNavItem[] = [
  { label: 'Overview', href: '/app', icon: icons.home },
  { label: 'Projects', href: '/app/projects', icon: icons.projects },
];

/** Admin area navigation. */
export const adminNav: AppNavItem[] = [
  { label: 'Overview', href: '/admin', icon: icons.home },
  { label: 'Clients', href: '/admin/clients', icon: icons.clients },
  { label: 'Projects', href: '/admin/projects', icon: icons.projects },
];
