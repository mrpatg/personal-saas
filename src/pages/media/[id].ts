/** Serves an uploaded image to signed-in users (see src/lib/media.ts). */
import type { APIRoute } from 'astro';
import { getImage } from '../../lib/media';

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response('Not found', { status: 404 });
  const img = await getImage(params.id ?? '');
  if (!img) return new Response('Not found', { status: 404 });
  const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': img.contentType,
      // Each upload gets a new id, so the bytes behind a URL never change.
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
};
