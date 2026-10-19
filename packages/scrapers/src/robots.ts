/**
 * Lectura mínima de robots.txt: junta las reglas Disallow/Allow del grupo "*"
 * (o del que nombra a nuestro bot) y dice si una ruta está permitida.
 */
export function isAllowedByRobots(robotsTxt: string | null, path: string, agent = "preciosuy"): boolean {
  if (!robotsTxt) return true;

  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow") && value) {
        current.rules.push({ allow: key === "allow", path: value });
      }
    }
  }

  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!group) return true;

  // Gana la regla más específica (la más larga), como en el estándar RFC 9309.
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    if (matches(rule.path, path) && (!best || rule.path.length > best.length)) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  return best?.allow ?? true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
