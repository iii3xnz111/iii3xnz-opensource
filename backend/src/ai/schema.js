// Minimal JSON-Schema subset validator (type, enum, required, properties, items,
// additionalProperties:false, minimum/maximum). Enough to validate LLM structured
// output without adding a dependency. Returns an array of error strings.
export function validateJsonSchema(value, schema, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    const ok = allowed.some((a) => a === t || (a === "number" && t === "integer"));
    if (!ok) return [`${path}: expected ${allowed.join("|")}, got ${t}`];
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${path}: not one of the allowed values`);
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in value) errors.push(...validateJsonSchema(value[key], sub, `${path}.${key}`));
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(schema.properties || {})[key]) errors.push(`${path}.${key}: unexpected property`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validateJsonSchema(v, schema.items, `${path}[${i}]`)));
  return errors;
}
