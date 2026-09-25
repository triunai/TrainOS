import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The single class-name composer (same as TrainOS `shared/lib/utils`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
