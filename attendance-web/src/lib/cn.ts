import { clsx, type ClassValue } from 'clsx'

/** Gộp class names điều kiện */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}