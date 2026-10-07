import type { ReactNode } from "react";
import { chooseFile } from "./api.ts";
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function FileField({
  label,
  value,
  onChange,
  kind = "script",
  error,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  kind?: string;
  error: (s: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="inline">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/Users/seu_usuario/..."
        />
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void chooseFile(kind)
              .then((path) => path && onChange(path))
              .catch((e) => error(e.message))
          }
        >
          Escolher
        </button>
      </div>
    </Field>
  );
}
export function JsonField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  help?: string;
}) {
  return (
    <Field label={label} help={help}>
      <textarea
        className="code short"
        defaultValue={JSON.stringify(value, null, 2)}
        onBlur={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
            e.target.setCustomValidity("");
          } catch {
            e.target.setCustomValidity("JSON inválido");
          }
        }}
      />
    </Field>
  );
}
