/**
 * Session replay attribute masking for PostHog (`session_recording.maskAttributeFn`).
 *
 * Text masking (`maskTextSelector: '*'`) does not reach attributes, and the
 * dashboard copies customer values into them all over the place: `title` on
 * truncated grid cells, `alt` on avatars, `placeholder`, `href`, `src`,
 * `srcdoc`. This fails closed: only attributes that carry layout, styling, or
 * UI state keep their value in the recording. Everything else, including any
 * attribute added in the future, is masked in the browser before it is sent.
 */

const KEEP_EXACT = new Set([
  // styling and structure
  'class',
  'style',
  'id',
  'role',
  'type',
  'dir',
  'lang',
  'tabindex',
  'width',
  'height',
  'colspan',
  'rowspan',
  'hidden',
  'disabled',
  'checked',
  'selected',
  'open',
  'draggable',
  'for',
  'rel',
  'target',
  // accessibility state and relationships (ids, indexes, booleans; never labels)
  'aria-hidden',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
  'aria-pressed',
  'aria-current',
  'aria-orientation',
  'aria-haspopup',
  'aria-controls',
  'aria-labelledby',
  'aria-describedby',
  'aria-modal',
  'aria-live',
  'aria-busy',
  'aria-sort',
  'aria-level',
  'aria-rowindex',
  'aria-colindex',
  'aria-rowcount',
  'aria-colcount',
  'aria-multiselectable',
  'aria-readonly',
  'aria-required',
  'aria-invalid',
  // UI library state used by CSS selectors
  'data-state',
  'data-side',
  'data-align',
  'data-orientation',
  'data-disabled',
  'data-highlighted',
  'data-selected',
  'data-active',
  'data-slot',
  // SVG icon geometry and paint
  'xmlns',
  'viewbox',
  'fill',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'transform',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  // rrweb-generated layout metadata (never application strings)
  'rr_width',
  'rr_height',
  'rr_left',
  'rr_top',
  'rr_position',
  'rr_transform',
  'rr_display',
  'rr_scrollleft',
  'rr_scrolltop',
  'rr_mediastate',
  'rr_open_mode',
]);

export function maskReplayAttribute(name: string, value: string): string {
  if (!value || KEEP_EXACT.has(name.toLowerCase())) {
    return value;
  }
  return '*'.repeat(value.length);
}
