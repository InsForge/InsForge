export function isCloudHosting(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.origin.endsWith('.insforge.app');
}
