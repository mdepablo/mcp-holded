/**
 * Drop `undefined` values so optional MCP arguments are not sent to Holded.
 * `null` is preserved on purpose: the v2 API uses it to clear a field.
 */
export function compactBody(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}
