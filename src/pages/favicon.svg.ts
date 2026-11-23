import type { APIRoute } from 'astro';
import { site } from '../config/site';

/** Favicon built from the site config: the monogram on the accent color. */
export const prerender = true;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const GET: APIRoute = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="${escape(site.colors.accent)}"/>
  <text x="16" y="21.5" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${site.monogram.length > 2 ? 11 : 14}" font-weight="700" fill="#ffffff">${escape(site.monogram)}</text>
</svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
};
