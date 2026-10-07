import type { Schedule } from "./types.ts";
import { object, text, integer } from "./validation.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string) {
  let f = formatters.get(timezone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      throw new Error("Fuso horário inválido.");
    }
    formatters.set(timezone, f);
  }
  return f;
}
function parts(timestamp: number, timezone: string) {
  const p = Object.fromEntries(
    formatter(timezone)
      .formatToParts(timestamp)
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
  };
}
function civil(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error("Data deve incluir ano, mês, dia e hora.");
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const stamp = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(stamp);
  if (
    year < 1970 ||
    year > 9999 ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    throw new Error("Data inválida.");
  return { year, month, day, hour, minute, stamp };
}
export function localToInstant(value: string, timezone: string): string {
  const wanted = civil(value);
  const candidates = new Set<number>();
  for (const delta of [-2, -1, 0, 1, 2]) {
    const sample = wanted.stamp + delta * 86400000;
    const p = parts(sample, timezone);
    const offset =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - sample;
    const candidate = wanted.stamp - offset;
    const actual = parts(candidate, timezone);
    if (
      actual.year === wanted.year &&
      actual.month === wanted.month &&
      actual.day === wanted.day &&
      actual.hour === wanted.hour &&
      actual.minute === wanted.minute
    )
      candidates.add(candidate);
  }
  if (!candidates.size)
    throw new Error(
      "Esse horário não existe nesse fuso por uma mudança de horário de verão.",
    );
  return new Date(Math.min(...candidates)).toISOString();
}
function cronField(input: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const item of input.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
    if (!match) throw new Error("Expressão cron inválida.");
    const step = +(match[2] ?? 1);
    if (step < 1 || step > max - min + 1)
      throw new Error("Intervalo cron inválido.");
    const bounds =
      match[1] === "*" ? [min, max] : match[1].split("-").map(Number);
    const start = bounds[0],
      end = bounds[1] ?? (match[2] ? max : start);
    if (start < min || end > max || end < start)
      throw new Error("Campo cron fora do intervalo.");
    for (let n = start; n <= end; n += step) values.add(n);
  }
  return values;
}
export function validateSchedule(input: unknown): Schedule {
  const v = object(input);
  const timezone = text(v.timezone, "Fuso", 100);
  formatter(timezone);
  if (v.kind === "once") {
    const at = text(v.at, "Data", 30);
    localToInstant(at, timezone);
    return { kind: "once", timezone, at };
  }
  if (v.kind === "daily" || v.kind === "weekly") {
    const time = text(v.time, "Hora", 5);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Hora inválida.");
    if (v.kind === "daily") return { kind: "daily", timezone, time };
    if (!Array.isArray(v.weekdays) || !v.weekdays.length)
      throw new Error("Escolha os dias da semana.");
    const weekdays = [
      ...new Set(v.weekdays.map((x) => integer(x, "Dia da semana", 0, 6))),
    ];
    return { kind: "weekly", timezone, time, weekdays };
  }
  if (v.kind === "cron") {
    const expression = text(v.expression, "Cron", 200).trim();
    const fields = expression.split(/\s+/);
    if (fields.length !== 5) throw new Error("Cron deve ter cinco campos.");
    [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ].forEach(([a, b], i) => cronField(fields[i], a, b));
    return { kind: "cron", timezone, expression };
  }
  throw new Error("Tipo de agendamento inválido.");
}
export function nextOccurrence(input: Schedule, after: string): string | null {
  const rule = validateSchedule(input);
  const now = Date.parse(after);
  if (!Number.isFinite(now)) throw new Error("Referência de data inválida.");
  if (rule.kind === "once") {
    const at = localToInstant(rule.at, rule.timezone);
    return Date.parse(at) > now ? at : null;
  }
  const today = parts(now, rule.timezone);
  const base = Date.UTC(today.year, today.month - 1, today.day);
  const fields = rule.kind === "cron" ? rule.expression.split(/\s+/) : null;
  const sets = fields
    ? [
        [0, 59],
        [0, 23],
        [1, 31],
        [1, 12],
        [0, 6],
      ].map(([a, b], i) => cronField(fields[i], a, b))
    : null;
  for (let dayOffset = 0; dayOffset < 366 * 5; dayOffset++) {
    const d = new Date(base + dayOffset * 86400000);
    if (rule.kind === "weekly" && !rule.weekdays.includes(d.getUTCDay()))
      continue;
    if (sets && fields) {
      if (!sets[3].has(d.getUTCMonth() + 1)) continue;
      const dom = sets[2].has(d.getUTCDate()),
        dow = sets[4].has(d.getUTCDay());
      if (!(fields[2] === "*" ? dow : fields[4] === "*" ? dom : dom || dow))
        continue;
    }
    const date = d.toISOString().slice(0, 10);
    const times = sets
      ? [...sets[1]]
          .sort((a, b) => a - b)
          .flatMap((h) =>
            [...sets[0]]
              .sort((a, b) => a - b)
              .map(
                (m) =>
                  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
              ),
          )
      : [rule.kind === "cron" ? "" : rule.time];
    for (const time of times) {
      if (
        dayOffset === 0 &&
        time <
          `${String(today.hour).padStart(2, "0")}:${String(today.minute).padStart(2, "0")}`
      )
        continue;
      try {
        const at = localToInstant(`${date}T${time}`, rule.timezone);
        if (Date.parse(at) > now) return at;
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("não existe")))
          throw error;
      }
    }
  }
  return null;
}
