/**
 * Which attributions are trustworthy enough to measure a voice from.
 *
 * Speech tags measured 100% correct against known answers; the author's own
 * corrections are correct by definition. Every inference tier sits between 59%
 * and 79%, and its errors are not randomly distributed: a misattributed line
 * almost always belongs to the other speaker in the same conversation, which is
 * precisely the character any voice comparison most needs kept separate.
 *
 * Shared rather than repeated per route, because voice profiles, flags and arcs
 * must agree about it — a route that quietly admitted inferred lines would
 * produce numbers that disagree with the rest of the interface for reasons
 * nothing on screen could explain.
 */
export const RELIABLE_METHODS = ["tag", "manual"];

/** Whether a stored `DialogueLine.method` may be measured as somebody's voice. */
export function isReliableMethod(method: string | null): boolean {
  return method !== null && RELIABLE_METHODS.includes(method);
}
