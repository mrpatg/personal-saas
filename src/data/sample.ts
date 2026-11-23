/**
 * Fake data for the design preview pages in src/pages/preview/.
 * Delete this file (and those pages) once real data exists.
 */
import type { Tone } from '../components/ui/tones';

export const sampleUser = { name: 'Jordan Rivera', company: 'Northwind Health' };

export const taskStatus: Record<string, { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'progress' },
  review: { label: 'In review', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
};

export const invoiceStatus: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Due', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
};

export const sampleProjects = [
  {
    name: 'Patient intake app',
    summary: 'Replace paper intake forms with a tablet app connected to the scheduling system.',
    progress: 64,
    due: 'Jan 30, 2027',
    tasks: [
      { title: 'Finalize intake form fields with front desk', status: 'done' },
      { title: 'Build tablet check-in flow', status: 'done' },
      { title: 'Connect to scheduling API', status: 'in_progress' },
      { title: 'Staff walkthrough and feedback', status: 'review' },
      { title: 'Launch at the main clinic', status: 'todo' },
    ],
  },
  {
    name: 'Reporting dashboard',
    summary: 'Weekly visit and revenue numbers for leadership, refreshed every morning.',
    progress: 20,
    due: 'Mar 15, 2027',
    tasks: [
      { title: 'Agree on the five key metrics', status: 'done' },
      { title: 'Data access from billing system', status: 'in_progress' },
      { title: 'First draft of the dashboard', status: 'todo' },
    ],
  },
];

export const sampleInvoices = [
  { id: 'INV-1042', title: 'December development', issued: 'Dec 1, 2026', due: 'Dec 15, 2026', amount: 6400, status: 'open' },
  { id: 'INV-1035', title: 'November development', issued: 'Nov 1, 2026', due: 'Nov 15, 2026', amount: 5850, status: 'paid' },
  { id: 'INV-1028', title: 'Discovery workshop', issued: 'Oct 6, 2026', due: 'Oct 20, 2026', amount: 2400, status: 'paid' },
];

export const sampleInvoiceDetail = {
  ...sampleInvoices[0],
  billTo: ['Northwind Health', 'Attn: Jordan Rivera', '200 Market Street', 'Portland, OR 97201'],
  lines: [
    { description: 'Scheduling API integration', qty: 24, unit: 150 },
    { description: 'Tablet check-in flow, revisions', qty: 12, unit: 150 },
    { description: 'Project management and weekly calls', qty: 6, unit: 150 },
    { description: 'Hosting and monitoring (December)', qty: 1, unit: 100 },
  ],
  notes: 'Thank you for your business. Payment is due within 14 days.',
};

export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Icons for the app nav (24x24 outline path data). */
export const icons = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  invoices: 'M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zm2 6h6m-6 4h6',
  messages: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z',
};

export const previewNav = [
  { label: 'Overview', href: '/preview/dashboard', icon: icons.home },
  { label: 'Projects', href: '/preview/dashboard#projects', icon: icons.projects },
  { label: 'Invoices', href: '/preview/invoice', icon: icons.invoices },
  { label: 'Messages', href: '/preview/dashboard#messages', icon: icons.messages },
];

export const previewNotice = 'Design preview with sample data. Nothing here is real yet.';
