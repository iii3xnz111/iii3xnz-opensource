// A small recursive-character text splitter, the same idea as LangChain's default splitter:
// try to break on paragraph boundaries first, then lines, then sentences, then words, only
// falling back to a hard character cut if nothing else fits within chunkSize.
const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export function splitText(text, { chunkSize = 1000, chunkOverlap = 100 } = {}) {
  const size = Math.min(Math.max(Number(chunkSize) || 1000, 100), 20000);
  const overlap = Math.min(Math.max(Number(chunkOverlap) || 0, 0), Math.floor(size / 2));
  const input = String(text ?? "");
  if (!input.trim()) return [];

  function split(str, sepIndex) {
    if (str.length <= size) return [str];
    if (sepIndex >= SEPARATORS.length) {
      // Hard cut with overlap, the final fallback.
      const chunks = [];
      for (let i = 0; i < str.length; i += size - overlap) chunks.push(str.slice(i, i + size));
      return chunks;
    }
    const sep = SEPARATORS[sepIndex];
    const parts = sep ? str.split(sep) : [str];
    if (parts.length === 1) return split(str, sepIndex + 1);

    const chunks = [];
    let current = "";
    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (candidate.length <= size) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = part.length > size ? "" : part;
        if (part.length > size) chunks.push(...split(part, sepIndex + 1));
      }
    }
    if (current) chunks.push(current);

    // Apply overlap between adjacent chunks so context isn't lost at a boundary.
    if (overlap > 0 && chunks.length > 1) {
      return chunks.map((chunk, i) => (i === 0 ? chunk : chunk.slice(0, 0)) || chunk).map((chunk, i) => {
        if (i === 0) return chunk;
        const prevTail = chunks[i - 1].slice(-overlap);
        return prevTail + chunk;
      });
    }
    return chunks;
  }

  return split(input, 0).map((c) => c.trim()).filter(Boolean);
}
