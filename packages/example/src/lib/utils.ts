import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The shadcn class helper: merges conditional class lists and lets a later
 * Tailwind utility win over an earlier one of the same kind.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
