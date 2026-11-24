/** Shared Tailwind classes for form controls, so every form looks the same. */
export const inputClass =
  'mt-1.5 block h-11 w-full rounded-2xl bg-canvas px-4 text-[15px] ring-1 ring-line transition outline-none placeholder:text-muted/70 focus:ring-2 focus:ring-primary';

export const textareaClass =
  'mt-1.5 block min-h-24 w-full rounded-2xl bg-canvas px-4 py-3 text-[15px] leading-relaxed ring-1 ring-line transition outline-none placeholder:text-muted/70 focus:ring-2 focus:ring-primary';

/** Selects keep the browser's own arrow; px-3 leaves room for it inside the pill. */
export const selectClass = inputClass.replace('px-4', 'px-3');
