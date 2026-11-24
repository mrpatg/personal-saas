/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Signed-in user, or null. Set by src/middleware.ts on every request. */
    user: import('./lib/auth').SessionUser | null;
    session: import('./lib/auth').Session | null;
  }
}
