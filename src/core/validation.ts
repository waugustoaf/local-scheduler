export function object(
  value: unknown,
  label = "Configuração",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} inválida.`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 10000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} inválido.`);
  return value;
}
export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} inválido.`);
  return value;
}
export function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    value.some((x) => typeof x !== "string" || x.length > 10000)
  )
    throw new Error(`${label} inválido.`);
  return value as string[];
}
