/** Minúsculas, sin tildes y con espacios simples. Es la forma canónica para buscar y comparar. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.,%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valida un código EAN-8, EAN-13, UPC-A o GTIN-14 por su dígito verificador. */
export function isValidEan(code: string | null | undefined): code is string {
  if (!code || !/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Lleva cualquier EAN válido a 13 dígitos (los UPC-A llegan con 12). */
export function canonicalEan(code: string | null | undefined): string | null {
  if (!isValidEan(code)) return null;
  return code.length === 12 ? `0${code}` : code;
}
