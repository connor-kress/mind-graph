/**
 * Follows a link within a note, like a footnote: scrolls to its target in the
 * same note and moves focus there. The page's own hash picks the app's mode,
 * so it must not change.
 */
export function followNoteLink(
  event: { preventDefault(): void; currentTarget: Element },
  href: string,
) {
  event.preventDefault();
  const note = event.currentTarget.closest(".note-markdown");
  const find = (id: string) =>
    note?.querySelector<HTMLElement>(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
  const fragment = href.slice(1);
  let decoded;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // Not a valid escape, so only the fragment as written can match.
  }
  // Generated ids can contain % themselves, so the fragment as written comes first.
  const target = find(fragment) ?? (decoded === undefined ? undefined : find(decoded));
  if (!target) return;
  // A footnote isn't focusable by itself; leave links in the tab order.
  if (!target.matches("a[href], [tabindex]")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center" });
}
