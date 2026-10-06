import { rowToIntake, suggestMappingFor, type Mapping } from './import';
import type { IntakeInput } from './lead-service';

/** Flatten nested provider payloads: { a: { b: 1 } } -> { 'a.b': '1' }, arrays joined. */
export function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) { out[prefix] = obj.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', '); return out; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = String(obj);
  return out;
}

/**
 * Canonical provider fields -> intake input. An admin-supplied mapping (payload key -> target)
 * wins; otherwise column-name heuristics (the same ones the importer uses) apply.
 */
export function leadFromFields(fields: Record<string, unknown>, defs: any[], mapping?: Mapping): IntakeInput {
  const flat = flatten(fields);
  const headers = Object.keys(flat);
  const map: Mapping = { ...suggestMappingFor(headers, defs), ...(mapping ?? {}) };
  return rowToIntake(headers, headers.map((h) => flat[h]), map, defs);
}
