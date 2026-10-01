const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "";

export function getSupportEmail() {
  return SUPPORT_EMAIL;
}

export function getSupportComposeUrl(accountEmail = "") {
  if (!SUPPORT_EMAIL) return "";
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: SUPPORT_EMAIL,
    su: "iii3xnz support request",
    body: `Hi iii3xnz support,\n\nI need help with:\n\n\nAccount email: ${accountEmail}\n\nThank you,`,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
