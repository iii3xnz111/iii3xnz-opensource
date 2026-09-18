import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required. Set it before starting the backend.");
}

export function signToken(user, options = {}) {
  const rememberMe = options.rememberMe === true;
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan, rememberMe }, JWT_SECRET, {
    expiresIn: rememberMe ? "30d" : "8h",
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
