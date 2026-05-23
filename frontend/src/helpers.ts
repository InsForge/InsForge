export function isCloudHosting(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.location.origin.endsWith('.insforge.app') ||
    window.location.origin.endsWith('.insforge.dev')
  );
}
export function isInIframe(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.parent !== window;
}
