import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getBackendUrl = () => {
  const isHttp = window.location.protocol === 'http:';
  return isHttp ? 'http://localhost:7130' : window.location.origin;
};
