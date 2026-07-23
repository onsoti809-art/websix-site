// ID helpers.
export function id(): string {
  return crypto.randomUUID();
}

// Human-friendly public project reference, e.g. WX-2026-AB12C
export function publicId(): string {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (let i = 0; i < 5; i++) r += s[bytes[i] % s.length];
  return `WX-${new Date().getFullYear()}-${r}`;
}
