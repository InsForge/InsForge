/**
 * Compute the next available object key using the " (N)" suffix convention:
 * `photo.png` → `photo (1).png` → `photo (2).png`.
 *
 * The storage API has standard PUT semantics (409 on an existing key), so
 * the friendly auto-rename users expect from the dashboard lives here on the
 * client — same approach as Supabase Studio.
 */
export function nextAvailableObjectKey(existingKeys: string[], desiredKey: string): string {
  if (!existingKeys.includes(desiredKey)) {
    return desiredKey;
  }

  const lastDotIndex = desiredKey.lastIndexOf('.');
  const baseName = lastDotIndex > 0 ? desiredKey.slice(0, lastDotIndex) : desiredKey;
  const extension = lastDotIndex > 0 ? desiredKey.slice(lastDotIndex) : '';

  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const counterRegex = new RegExp(
    `^${escapeRegex(baseName)} \\((\\d+)\\)${escapeRegex(extension)}$`
  );

  let highestCounter = 0;
  for (const key of existingKeys) {
    const match = key.match(counterRegex);
    if (match) {
      highestCounter = Math.max(highestCounter, parseInt(match[1], 10));
    }
  }

  return `${baseName} (${highestCounter + 1})${extension}`;
}
