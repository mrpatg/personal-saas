/**
 * Small uploaded images (client photos, project images). Stored in D1 and
 * served at /media/<id> to signed-in users. The browser resizes images before
 * upload (src/components/ImageInput.astro); the server only checks them.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';

export const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
/** Upper limit after the browser's resize (a 256px image is usually 10-30 KB). */
export const MAX_IMAGE_BYTES = 400 * 1024;
const PREFIX = '/media/';

export type ImageChange = { kind: 'none' } | { kind: 'remove' } | { kind: 'set'; file: File } | { kind: 'error'; message: string };

/** Reads the "image" file input and "removeImage" checkbox from a form. */
export function readImageField(form: FormData, name = 'image'): ImageChange {
  if (form.get(`remove_${name}`) === 'on') return { kind: 'remove' };
  const file = form.get(name);
  if (!(file instanceof File) || file.size === 0) return { kind: 'none' };
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return { kind: 'error', message: 'Use a JPG, PNG or WebP image.' };
  if (file.size > MAX_IMAGE_BYTES) return { kind: 'error', message: `That image is too large (${Math.round(file.size / 1024)} KB). Use one under ${MAX_IMAGE_BYTES / 1024} KB.` };
  return { kind: 'set', file };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Saves an uploaded image and returns its URL. */
export async function saveImage(file: File, owner: { type: 'user' | 'project'; id: string }, createdById: string): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .insert(schema.media)
    .values({ id, contentType: file.type, data: toBase64(await file.arrayBuffer()), bytes: file.size, ownerType: owner.type, ownerId: owner.id, createdById })
    .run();
  return `${PREFIX}${id}`;
}

/** Deletes the stored image behind a /media/<id> URL (no-op for anything else). */
export async function deleteImage(url: string | null | undefined) {
  if (!url?.startsWith(PREFIX)) return;
  await getDb().delete(schema.media).where(eq(schema.media.id, url.slice(PREFIX.length))).run();
}

/**
 * Applies an image change: saves the new image and deletes the old one.
 * Returns the new URL (or null when removed); `undefined` means unchanged.
 */
export async function applyImageChange(change: ImageChange, current: string | null, owner: { type: 'user' | 'project'; id: string }, actorId: string): Promise<string | null | undefined> {
  if (change.kind === 'set') {
    const url = await saveImage(change.file, owner, actorId);
    await deleteImage(current);
    return url;
  }
  if (change.kind === 'remove' && current) {
    await deleteImage(current);
    return null;
  }
  return undefined;
}

export function getImage(id: string) {
  return getDb().select().from(schema.media).where(eq(schema.media.id, id)).get();
}
