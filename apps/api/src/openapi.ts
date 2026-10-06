import type { INestApplication, Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { getMetadataStorage } from 'class-validator';
// class-transformer only exposes its metadata store from an internal path (its types live elsewhere)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { defaultMetadataStorage } = require('class-transformer/cjs/storage') as { defaultMetadataStorage: { findTypeMetadata(t: new (...a: never[]) => unknown, p: string): { typeFunction?: () => unknown } | undefined } };

type Schema = Record<string, any>;
const PARAMTYPES = 'design:paramtypes';
const SCALARS = new Set([String, Number, Boolean, Object, Array, Date, undefined]);

/** Request body classes used by controller handlers (and the classes nested inside them), by name. */
export function dtoClasses(app: INestApplication, onClash?: (name: string) => void): Map<string, Type> {
  const out = new Map<string, Type>();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const w of mod.controllers.values()) {
      const proto = w.metatype?.prototype; if (!proto) continue;
      for (const name of Object.getOwnPropertyNames(proto)) {
        for (const t of (Reflect.getMetadata(PARAMTYPES, proto, name) ?? []) as Type[]) if (typeof t === 'function' && !SCALARS.has(t as any) && /Dto$/.test(t.name)) { if (out.has(t.name) && out.get(t.name) !== t) onClash?.(t.name); out.set(t.name, t); }
      }
    }
  }
  // classes only reachable through @ValidateNested + @Type (rule items, step items...) are documented too
  for (const cls of [...out.values()]) {
    for (const m of getMetadataStorage().getTargetValidationMetadatas(cls, undefined as any, false, false) as any[]) {
      if (m.type !== 'nestedValidation') continue;
      const t = defaultMetadataStorage.findTypeMetadata(cls as never, m.propertyName)?.typeFunction?.() as Type | undefined;
      if (t && typeof t === 'function' && !SCALARS.has(t as any) && !out.has(t.name)) out.set(t.name, t);
    }
  }
  return out;
}

/**
 * Turns class-validator decorators on request DTOs into JSON Schema, so `/openapi.json` documents what each endpoint accepts
 * (types, formats, enums, lengths, ranges, required fields). Response bodies are not annotated.
 */
export function schemaFor(cls: Type, known: ReadonlySet<string>): Schema {
  const metas = getMetadataStorage().getTargetValidationMetadatas(cls, undefined as any, false, false);
  const props: Record<string, Schema> = {}; const optional = new Set<string>();
  for (const m of metas as any[]) {
    const p = (props[m.propertyName] ??= {}); const c = m.constraints ?? [];
    if (m.type === 'conditionalValidation') { optional.add(m.propertyName); continue; }
    if (m.type === 'nestedValidation') continue;
    switch (m.name) {
      case 'isString': p.type = 'string'; break;
      case 'isInt': p.type = 'integer'; break;
      case 'isNumber': p.type = 'number'; break;
      case 'isBoolean': p.type = 'boolean'; break;
      case 'isObject': p.type = 'object'; break;
      case 'isArray': p.type = 'array'; break;
      case 'isEmail': p.type = 'string'; p.format = 'email'; break;
      case 'isDateString': p.type = 'string'; p.format = 'date-time'; break;
      case 'isIn': p.enum = [...(c[0] ?? [])]; p.type ??= typeof (c[0] ?? [])[0] === 'number' ? 'number' : 'string'; break;
      case 'minLength': p.minLength = c[0]; break;
      case 'maxLength': p.maxLength = c[0]; break;
      case 'min': p.minimum = c[0]; break;
      case 'max': p.maximum = c[0]; break;
      case 'matches': p.pattern = String(c[0] instanceof RegExp ? c[0].source : c[0]); p.type ??= 'string'; break;
      case 'arrayMaxSize': p.maxItems = c[0]; break;
      case 'arrayMinSize': p.minItems = c[0]; break;
      default: break;
    }
    if (m.each && p.type && p.type !== 'array') { p.items = { type: p.type, ...(p.enum ? { enum: p.enum } : {}) }; delete p.enum; p.type = 'array'; } // @IsString({ each: true })
  }
  for (const m of metas as any[]) if (m.type === 'nestedValidation') {
    const t = defaultMetadataStorage.findTypeMetadata(cls as never, m.propertyName)?.typeFunction?.() as Type | undefined;
    if (t && known.has(t.name)) { const ref = { $ref: `#/components/schemas/${t.name}` }; props[m.propertyName] = props[m.propertyName]?.type === 'array' || m.each ? { type: 'array', items: ref } : ref; }
  }
  const required = Object.keys(props).filter((k) => !optional.has(k));
  return { type: 'object', properties: props, ...(required.length ? { required } : {}) };
}

export function enrichOpenApi(doc: { components?: { schemas?: Record<string, Schema> } }, app: INestApplication) {
  const classes = dtoClasses(app); const schemas = (doc.components ??= {}).schemas ??= {}; const known = new Set(classes.keys());
  for (const [name, cls] of classes) schemas[name] = schemaFor(cls, known);
  return doc;
}
