import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The single class-name composer. Tailwind classes merge, conflicts resolve last-wins. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
