import { Field, FileField, JsonField } from "./fields.tsx";
import type { Profile } from "../core/types.ts";
import type { ComponentType } from "react";
export interface EditorProps {
  config: any;
  setConfig: (c: any) => void;
  profiles: Profile[];
  error: (s: string) => void;
}
export interface Editor {
  id: string;
  label: string;
  description: string;
  initial: () => any;
  component: ComponentType<EditorProps>;
}
const editors = new Map<string, Editor>();
export function registerEditor(editor: Editor) {
  if (editors.has(editor.id)) throw new Error("Editor já registrado.");
  editors.set(editor.id, editor);
}
export function getEditor(id: string) {
  const editor = editors.get(id);
  if (!editor) throw new Error("Editor indisponível.");
  return editor;
}
export function listEditors() {
  return [...editors.values()];
}
function SQLEditor({ config: c, setConfig: set, profiles }: EditorProps) {
  return (
    <>
      <Field label="Banco de dados">
        <select
          required
          value={c.databaseId}
          onChange={(e) => set({ ...c, databaseId: e.target.value })}
        >
          <option value="">Selecione uma conexão salva</option>
          {profiles
            .filter((p) => p.kind === "database")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </Field>
      <Field
        label="Query"
        help="A query será executada exatamente como escrita. O teste de conexão usa apenas SELECT 1."
      >
        <textarea
          required
          className="code sql"
          spellCheck={false}
          value={c.query}
          onChange={(e) => set({ ...c, query: e.target.value })}
          placeholder="SELECT current_database(), clock_timestamp();"
        />
      </Field>
      <JsonField
        label="Parâmetros"
        value={c.parameters}
        onChange={(v) => set({ ...c, parameters: v })}
        help="Lista JSON para os parâmetros $1, $2 etc."
      />
      <label className="check">
        <input
          type="checkbox"
          checked={c.transaction}
          onChange={(e) => set({ ...c, transaction: e.target.checked })}
        />
        Executar dentro de uma transação
      </label>
      {c.transaction && (
        <p className="note">
          Use queries sem BEGIN, COMMIT ou ROLLBACK próprios. Não inclui
          comandos incompatíveis com transações, como VACUUM.
        </p>
      )}
    </>
  );
}
function ScriptEditor({
  config: c,
  setConfig: set,
  profiles,
  error,
}: EditorProps) {
  return (
    <>
      <div className="grid2">
        <Field label="Executar em">
          <select
            value={c.target}
            onChange={(e) => set({ ...c, target: e.target.value })}
          >
            <option value="local">Neste Mac</option>
            <option value="ssh">Servidor via SSH</option>
          </select>
        </Field>
        <Field label="Origem">
          <select
            value={c.source}
            onChange={(e) => set({ ...c, source: e.target.value })}
          >
            <option value="inline">Script salvo no agendamento</option>
            <option value="file">Arquivo no destino</option>
          </select>
        </Field>
      </div>
      {c.target === "ssh" && (
        <Field label="Conexão SSH">
          <select
            required
            value={c.sshProfileId}
            onChange={(e) => set({ ...c, sshProfileId: e.target.value })}
          >
            <option value="">Selecione uma conexão</option>
            {profiles
              .filter((p) => p.kind === "ssh")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {c.source === "inline" ? (
        <Field
          label="Script"
          help="O conteúdo fica salvo. Edite aqui para alterar a próxima execução."
        >
          <textarea
            required
            className="code sql"
            spellCheck={false}
            value={c.script}
            onChange={(e) => set({ ...c, script: e.target.value })}
            placeholder={'printf "Agendamento funcionou\\n"'}
          />
        </Field>
      ) : c.target === "local" ? (
        <FileField
          label="Arquivo .sh"
          value={c.filePath}
          onChange={(v) => set({ ...c, filePath: v })}
          error={error}
        />
      ) : (
        <Field label="Caminho do arquivo no servidor">
          <input
            required
            value={c.filePath}
            onChange={(e) => set({ ...c, filePath: e.target.value })}
            placeholder="/home/usuario/script.sh"
          />
        </Field>
      )}
      {c.source === "file" && (
        <p className="note">
          O arquivo será lido na hora da execução. Para preservar o conteúdo,
          copie o script para a opção de script salvo.
        </p>
      )}
      <div className="grid2">
        <Field label="Interpretador">
          <input
            required
            value={c.interpreter}
            onChange={(e) => set({ ...c, interpreter: e.target.value })}
          />
        </Field>
        <Field label="Diretório de trabalho">
          <input
            value={c.cwd}
            onChange={(e) => set({ ...c, cwd: e.target.value })}
            placeholder="Padrão do agente"
          />
        </Field>
      </div>
      <JsonField
        label="Argumentos"
        value={c.arguments}
        onChange={(v) => set({ ...c, arguments: v })}
        help={'Lista JSON, por exemplo ["production", "--check"].'}
      />
      <JsonField
        label="Variáveis de ambiente"
        value={c.env}
        onChange={(v) => set({ ...c, env: v })}
        help="Objeto JSON. Para credenciais de conexão use os perfis protegidos pelo Keychain."
      />
      <Field label="Entrada padrão (stdin)">
        <textarea
          value={c.stdin}
          onChange={(e) => set({ ...c, stdin: e.target.value })}
        />
      </Field>
    </>
  );
}
registerEditor({
  id: "sql",
  label: "SQL",
  description: "Execute uma query em um banco salvo",
  initial: () => ({
    databaseId: "",
    query: "",
    parameters: [],
    transaction: false,
  }),
  component: SQLEditor,
});
registerEditor({
  id: "scripts",
  label: "Scripts",
  description: "Execute no Mac ou em um servidor via SSH",
  initial: () => ({
    target: "local",
    sshProfileId: "",
    source: "inline",
    script: "",
    filePath: "",
    interpreter: "/bin/bash",
    arguments: [],
    cwd: "",
    env: {},
    stdin: "",
  }),
  component: ScriptEditor,
});
