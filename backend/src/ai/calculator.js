// Safe arithmetic evaluator (no eval / Function). Supports + - * / % ^ ( ) and decimals.
export function calculate(expression) {
  const src = String(expression ?? "");
  if (src.length > 200) throw new Error("Expression too long");
  const tokens = src.match(/\d+\.?\d*|\.\d+|[-+*/%^()]|\s+|./g) || [];
  const toks = tokens.filter((t) => !/^\s+$/.test(t));
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  function primary() {
    const t = next();
    if (t === undefined) throw new Error("Unexpected end of expression");
    if (t === "(") { const v = addSub(); if (next() !== ")") throw new Error("Missing closing parenthesis"); return v; }
    if (t === "-") return -power();
    if (t === "+") return power();
    if (/^(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
    throw new Error(`Unexpected token "${t}"`);
  }
  function power() { const base = primary(); if (peek() === "^") { next(); return Math.pow(base, power()); } return base; }
  function mulDiv() {
    let v = power();
    while (["*", "/", "%"].includes(peek())) {
      const op = next(); const r = power();
      if (op === "*") v *= r; else if (op === "/") { if (r === 0) throw new Error("Division by zero"); v /= r; } else { if (r === 0) throw new Error("Division by zero"); v %= r; }
    }
    return v;
  }
  function addSub() { let v = mulDiv(); while (["+", "-"].includes(peek())) { const op = next(); const r = mulDiv(); v = op === "+" ? v + r : v - r; } return v; }
  const result = addSub();
  if (pos < toks.length) throw new Error(`Unexpected token "${toks[pos]}"`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}
