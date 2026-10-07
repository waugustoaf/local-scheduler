import { useEffect, useState } from "react";
import type {
  Task,
  TaskInput,
  Profile,
  Memory,
  Run,
  Schedule,
} from "../core/types.ts";
import { call, preview, type Snapshot } from "./api.ts";
import { getEditor, listEditors } from "./moduleEditors.tsx";
import { Field, FileField } from "./fields.tsx";

type Page = "agenda" | "connections" | "library" | "history" | "settings";
const labels: Record<Page, string> = {
  agenda: "Agenda",
  connections: "Conexões",
  library: "Biblioteca",
  history: "Histórico",
  settings: "Configurações",
};
const descriptions: Record<Page, string> = {
  agenda: "Suas próximas ações, no horário certo.",
  connections: "Acessos salvos para usar em qualquer agendamento.",
  library: "Configurações que você pode reutilizar.",
  history: "Resultados e saídas de cada execução.",
  settings: "Deixe o Mac pronto para agir por você.",
};
const statuses: Record<string, string> = {
  success: "Concluído",
  failed: "Falhou",
  unknown: "Verificar resultado",
  missed: "Não executado",
  running: "Executando",
  preparing: "Preparando",
  cancelled: "Cancelado",
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    agenda: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 11h18M7 15h3m4 0h3" />
      </>
    ),
    connections: (
      <>
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
      </>
    ),
    library: (
      <>
        <rect x="3" y="3" width="6" height="18" rx="1" />
        <rect x="11" y="3" width="4" height="18" rx="1" />
        <path d="m17 4 4 16" />
      </>
    ),
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />
      </>
    ),
    settings: (
      <>
        <path d="M5 4v16m7-16v16m7-16v16M2 9h6m1 6h6m1-7h6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    sql: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    scripts: (
      <>
        <path d="m5 7 5 5-5 5m8 0h6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.clock}
    </svg>
  );
}
function date(value: string | null, timezone = "America/Sao_Paulo") {
  if (!value) return "Sem próxima execução";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function scheduleLabel(s: Schedule) {
  if (s.kind === "once") return `${s.at.replace("T", " às ")} · ${s.timezone}`;
  if (s.kind === "cron") return `Cron ${s.expression} · ${s.timezone}`;
  return `${s.kind === "daily" ? "Todos os dias" : s.weekdays.map((d) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d]).join(", ")} às ${s.time} · ${s.timezone}`;
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onClose]);
  return (
    <div className="overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modalHead">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="iconButton" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
const defaultTask = (): TaskInput => ({
  name: "",
  moduleId: "sql",
  config: getEditor("sql").initial(),
  schedule: { kind: "once", timezone: "America/Sao_Paulo", at: "" },
  enabled: true,
  wake: true,
  toleranceMinutes: 5,
  timeoutSeconds: 120,
});

export function App() {
  const [page, setPage] = useState<Page>("agenda"),
    [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [task, setTask] = useState<TaskInput | null>(null),
    [profile, setProfile] = useState<any | null>(null),
    [run, setRun] = useState<Run | null>(null),
    [logs, setLogs] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [power, setPower] = useState(false),
    [query, setQuery] = useState(""),
    [agentOnline, setAgentOnline] = useState(false),
    [agentError, setAgentError] = useState("");
  const refresh = async () => {
    try {
      const snapshot = await call("snapshot");
      setData(snapshot);
      setAgentOnline(!!snapshot.agent);
      setAgentError("");
    } catch (e) {
      setAgentOnline(false);
      setAgentError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const act = async (method: string, args: unknown, message = "Salvo") => {
    setBusy(true);
    setError("");
    try {
      const result = await call(method, args);
      await refresh();
      setToast(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const newProfile = (kind: "ssh" | "database") =>
    setProfile({
      kind,
      name: "",
      value:
        kind === "ssh"
          ? {
              host: "",
              port: 22,
              username: "",
              auth: "key",
              keyPath: "",
              fingerprint: "",
            }
          : {
              driver: "postgres",
              host: "",
              port: 5432,
              database: "",
              username: "",
              tls: "verify",
              caPath: "",
              sshProfileId: "",
            },
      password: "",
      passphrase: "",
    });
  const tasks = (data?.tasks ?? []).filter((t) =>
    t.name.toLowerCase().includes(query.toLowerCase()),
  );
  const openRun = async (r: Run) => {
    setRun(r);
    try {
      setLogs(await call("logs", { id: r.id }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">
            <Icon name="clock" size={23} />
          </span>
          <div>
            Local Scheduler<small>SEU MAC, NO HORÁRIO</small>
          </div>
        </div>
        <nav>
          {(Object.keys(labels) as Page[]).map((key) => (
            <button
              key={key}
              className={page === key ? "selected" : ""}
              onClick={() => {
                setPage(key);
                setQuery("");
              }}
            >
              <Icon name={key} />
              {labels[key]}
              {key === "agenda" && !!data?.tasks.length && (
                <span className="count">{data.tasks.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebarFoot">
          <span className={`dot ${agentOnline ? "green" : ""}`} />
          {preview
            ? "Prévia da interface"
            : agentOnline
              ? "Agente disponível"
              : "Conectando ao agente"}
          <small>Local · America/Sao_Paulo</small>
        </div>
      </aside>
      <main>
        <div className="dragbar" />
        <header>
          <div>
            <span className="eyebrow">LOCAL SCHEDULER</span>
            <h1>{labels[page]}</h1>
            <p>{descriptions[page]}</p>
          </div>
          {page === "agenda" && (
            <button className="primary" onClick={() => setTask(defaultTask())}>
              <Icon name="plus" />
              Novo agendamento
            </button>
          )}
          {page === "connections" && (
            <div className="inline">
              <button className="secondary" onClick={() => newProfile("ssh")}>
                Novo SSH
              </button>
              <button
                className="primary"
                onClick={() => newProfile("database")}
              >
                Novo banco
              </button>
            </div>
          )}
        </header>
        {preview && (
          <div className="banner">
            Prévia visual. Os dados ficam neste navegador; nenhuma ação será
            executada.
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Fechar erro">
              <Icon name="close" />
            </button>
          </div>
        )}
        {!preview && (
          <section
            className={`executorStatus ${agentOnline ? "online" : "offline"}`}
            role="status"
          >
            <div>
              <strong>
                {agentOnline
                  ? "Executor em segundo plano ativo"
                  : "Executor indisponível"}
              </strong>
              <p>
                {agentOnline
                  ? "Inicia com sua sessão no Mac e continua funcionando ao fechar o dashboard."
                  : "Os agendamentos não podem ser confirmados até a conexão voltar."}
              </p>
              {agentError && <small>{agentError}</small>}
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void act("repairAgent", {}, "Executor verificado")}
            >
              Verificar executor
            </button>
          </section>
        )}
        {!!data?.alerts?.filter((a) => !a.readAt).length && (
          <section className="alertsPanel" aria-label="Avisos pendentes">
            <h2>
              Atenção necessária{" "}
              <span>{data.alerts.filter((a) => !a.readAt).length}</span>
            </h2>
            {data.alerts
              .filter((a) => !a.readAt)
              .slice(0, 10)
              .map((a) => (
                <article key={a.id}>
                  <div>
                    <h3>{a.title}</h3>
                    <p>{a.message}</p>
                    <small>{date(a.createdAt)}</small>
                  </div>
                  <div className="inline">
                    {a.runId && (
                      <button
                        className="textButton"
                        onClick={() => {
                          const r = data.runs.find((r) => r.id === a.runId);
                          if (r) void openRun(r);
                          else setPage("history");
                        }}
                      >
                        Ver resultado
                      </button>
                    )}
                    <button
                      className="secondary"
                      onClick={() =>
                        void act(
                          "ackAlert",
                          { id: a.id },
                          "Aviso marcado como visto",
                        )
                      }
                    >
                      Marcar como visto
                    </button>
                  </div>
                </article>
              ))}
          </section>
        )}
        {!data ? (
          <div className="empty">
            <Icon name="clock" size={32} />
            <h2>Conectando ao agente</h2>
            <p>Os seus agendamentos aparecerão aqui.</p>
          </div>
        ) : (
          <>
            {page === "agenda" && (
              <>
                <div className="stats">
                  <div>
                    <small>ATIVOS</small>
                    <strong>
                      {data.tasks.filter((t) => t.enabled && t.nextAt).length}
                    </strong>
                    <span>agendamentos futuros</span>
                  </div>
                  <div>
                    <small>PRÓXIMA AÇÃO</small>
                    <strong className="statDate">
                      {date(
                        data.tasks.find((t) => t.enabled && t.nextAt)?.nextAt ??
                          null,
                      )}
                    </strong>
                    <span>Fuso do agendamento</span>
                  </div>
                  <div>
                    <small>EXECUÇÕES</small>
                    <strong>
                      {data.runs.filter((r) => r.status === "success").length}
                    </strong>
                    <span>concluídas no histórico recente</span>
                  </div>
                </div>
                <div className="sectionBar">
                  <h2>
                    Agendamentos <span>{data.tasks.length}</span>
                  </h2>
                  <input
                    className="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por nome"
                    aria-label="Buscar agendamentos"
                  />
                </div>
                {tasks.length === 0 ? (
                  <div className="empty bordered">
                    <div className="emptyIcon">
                      <Icon name="agenda" size={30} />
                    </div>
                    <h2>
                      {query
                        ? "Nenhum resultado"
                        : "Sua próxima ação começa aqui"}
                    </h2>
                    <p>
                      Salve uma query ou um script e escolha quando executar.
                      <br />O agente cuida do restante.
                    </p>
                    {!query && (
                      <button
                        className="secondary"
                        onClick={() => setTask(defaultTask())}
                      >
                        Criar primeiro agendamento
                        <Icon name="arrow" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="taskList">
                    {tasks.map((t) => (
                      <article className="taskRow" key={t.id}>
                        <div className="moduleIcon">
                          <Icon name={t.moduleId} />
                        </div>
                        <div className="rowTitle">
                          <h3>{t.name}</h3>
                          <p>{scheduleLabel(t.schedule)}</p>
                          <small>
                            {t.wake ? "Despertar 5 min antes" : "Sem despertar"}{" "}
                            · Limite {t.timeoutSeconds}s
                          </small>
                        </div>
                        <div className="rowState">
                          <span
                            className={`badge ${t.enabled && t.nextAt ? "success" : "muted"}`}
                          >
                            {t.enabled && t.nextAt
                              ? "Agendado"
                              : t.enabled
                                ? "Finalizado"
                                : "Pausado"}
                          </span>
                          <small>{date(t.nextAt, t.schedule.timezone)}</small>
                        </div>
                        <div className="rowActions">
                          <button
                            className="textButton"
                            onClick={() => setTask({ ...t })}
                          >
                            Editar
                          </button>
                          <button
                            className="textButton"
                            onClick={() =>
                              void act(
                                "toggleTask",
                                { id: t.id, enabled: !t.enabled },
                                t.enabled ? "Pausado" : "Ativado",
                              )
                            }
                          >
                            {t.enabled ? "Pausar" : "Ativar"}
                          </button>
                          <button
                            className="textButton"
                            onClick={() => {
                              if (
                                confirm(
                                  `Executar agora “${t.name}”? A ação poderá alterar o destino.`,
                                )
                              )
                                void act(
                                  "runTask",
                                  { id: t.id },
                                  "Execução iniciada",
                                );
                            }}
                          >
                            Executar agora
                          </button>
                          <button
                            className="textButton danger"
                            onClick={() => {
                              if (
                                confirm(
                                  `Excluir o agendamento “${t.name}”? O histórico será preservado.`,
                                )
                              )
                                void act(
                                  "deleteTask",
                                  { id: t.id },
                                  "Agendamento excluído",
                                );
                            }}
                          >
                            Excluir
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div className="notePanel">
                  <Icon name="clock" />
                  <p>
                    <strong>Funciona com a janela fechada.</strong> O agente
                    continua disponível na sua sessão. Ative o serviço de
                    despertar em Configurações para executar com o Mac em
                    repouso.
                  </p>
                  <button
                    className="textButton"
                    onClick={() => setPage("settings")}
                  >
                    Configurar
                    <Icon name="arrow" />
                  </button>
                </div>
              </>
            )}
            {page === "connections" && (
              <>
                {["ssh", "database"].map((kind) => (
                  <section key={kind} className="connectionSection">
                    <h2>
                      {kind === "ssh" ? "Servidores SSH" : "Bancos de dados"}{" "}
                      <span>
                        {data.profiles.filter((p) => p.kind === kind).length}
                      </span>
                    </h2>
                    {!data.profiles.some((p) => p.kind === kind) ? (
                      <div className="smallEmpty">
                        {kind === "ssh"
                          ? "Cadastre um servidor para túneis e scripts remotos."
                          : "Cadastre um banco PostgreSQL para reutilizar nos agendamentos."}
                      </div>
                    ) : (
                      data.profiles
                        .filter((p) => p.kind === kind)
                        .map((p) => (
                          <article className="connectionRow" key={p.id}>
                            <div className="moduleIcon">
                              <Icon
                                name={kind === "ssh" ? "connections" : "sql"}
                              />
                            </div>
                            <div className="rowTitle">
                              <h3>{p.name}</h3>
                              <p>
                                {String(p.value.username)}@
                                {String(p.value.host)}:
                                {String(
                                  p.value.port ?? (kind === "ssh" ? 22 : 5432),
                                )}
                                {kind === "database" &&
                                  ` · ${String(p.value.database)}`}
                              </p>
                              <small>
                                {kind === "ssh"
                                  ? p.value.fingerprint
                                    ? "Fingerprint confirmado"
                                    : "Fingerprint pendente"
                                  : p.value.sshProfileId
                                    ? "Via túnel SSH"
                                    : "Conexão direta"}
                              </small>
                            </div>
                            <div className="inline">
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={async () => {
                                  const result = await act(
                                    "testProfile",
                                    { id: p.id },
                                    "Teste concluído",
                                  );
                                  if (!result) return;
                                  if (result.fingerprint) {
                                    if (
                                      confirm(
                                        `Confirme com o administrador do servidor:\n${result.fingerprint}\n\nSalvar este fingerprint?`,
                                      )
                                    )
                                      await act(
                                        "saveProfile",
                                        {
                                          ...p,
                                          value: {
                                            ...p.value,
                                            fingerprint: result.fingerprint,
                                          },
                                        },
                                        "Fingerprint salvo",
                                      );
                                  } else setToast(result.message);
                                }}
                              >
                                Testar conexão
                              </button>
                              <button
                                className="textButton"
                                onClick={() =>
                                  setProfile({
                                    ...p,
                                    value: { ...p.value },
                                    password: "",
                                    passphrase: "",
                                  })
                                }
                              >
                                Editar
                              </button>
                              <button
                                className="textButton danger"
                                onClick={() => {
                                  if (confirm(`Excluir “${p.name}”?`))
                                    void act(
                                      "deleteProfile",
                                      { id: p.id },
                                      "Conexão excluída",
                                    );
                                }}
                              >
                                Excluir
                              </button>
                            </div>
                          </article>
                        ))
                    )}
                  </section>
                ))}
                <p className="note">
                  As senhas e passphrases são criptografadas com proteção do
                  Keychain. O agente precisa de credenciais disponíveis sem
                  interação na hora do agendamento.
                </p>
              </>
            )}
            {page === "library" && (
              <>
                {data.memories.length === 0 ? (
                  <div className="empty bordered">
                    <div className="emptyIcon">
                      <Icon name="library" size={30} />
                    </div>
                    <h2>Guarde o que você usa de novo</h2>
                    <p>
                      Ao criar um agendamento, salve a configuração como
                      memória.
                      <br />
                      Depois, crie novas ações a partir dela.
                    </p>
                    <button
                      className="secondary"
                      onClick={() => setTask(defaultTask())}
                    >
                      Criar agendamento
                    </button>
                  </div>
                ) : (
                  <div className="memoryGrid">
                    {data.memories.map((m) => (
                      <article className="memory" key={m.id}>
                        <Icon name={m.namespace} />
                        <span className="eyebrow">
                          {m.namespace === "sql" ? "SQL" : "SCRIPTS"}
                        </span>
                        <h3>{m.name}</h3>
                        <p>Configuração salva · versão {m.version}</p>
                        <div className="inline">
                          <button
                            className="secondary"
                            onClick={() =>
                              setTask({
                                ...defaultTask(),
                                name: m.name,
                                moduleId: m.namespace,
                                config: structuredClone(m.value),
                              })
                            }
                          >
                            Usar memória
                            <Icon name="arrow" />
                          </button>
                          <button
                            className="textButton danger"
                            onClick={() =>
                              void act(
                                "deleteMemory",
                                { id: m.id },
                                "Memória excluída",
                              )
                            }
                          >
                            Excluir
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
            {page === "history" && (
              <>
                {data.runs.length === 0 ? (
                  <div className="empty bordered">
                    <Icon name="history" size={32} />
                    <h2>Ainda não há execuções</h2>
                    <p>
                      Cada ação terá um resultado e sua saída registrada aqui.
                    </p>
                  </div>
                ) : (
                  <div className="historyList">
                    {data.runs.map((r) => (
                      <button
                        className="historyRow"
                        key={r.id}
                        onClick={() => void openRun(r)}
                      >
                        <span className={`badge ${r.status}`}>
                          {statuses[r.status]}
                        </span>
                        <div>
                          <h3>{r.taskName}</h3>
                          <p>{r.summary || "Execução em andamento"}</p>
                        </div>
                        <small>
                          {date(r.startedAt ?? r.scheduledAt.split("#")[0])}
                        </small>
                        <Icon name="arrow" />
                      </button>
                    ))}
                  </div>
                )}
                <p className="note">
                  Se a execução for interrompida, o resultado poderá ficar
                  incerto. Confira o destino antes de repetir; a aplicação nunca
                  repete uma ação automaticamente.
                </p>
              </>
            )}
            {page === "settings" && (
              <>
                <section className="settingsCard">
                  <h2>Notificações do executor</h2>
                  <p>
                    Falhas, interrupções e ações fora da janela geram avisos,
                    mesmo com o dashboard fechado. Os avisos ficam pendentes até
                    serem marcados como vistos.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      const result = await act(
                        "testNotification",
                        {},
                        "Teste enviado",
                      );
                      if (result && !result.supported)
                        setError(
                          "O macOS não disponibilizou notificações para este aplicativo.",
                        );
                    }}
                  >
                    Testar notificação
                  </button>
                  <p className="note">
                    Permita notificações para Local Scheduler em Ajustes do
                    Sistema. O modo Foco pode ocultar banners; os avisos
                    continuam visíveis no aplicativo.
                  </p>
                </section>
                <section className="settingsCard">
                  <div className="sectionBar">
                    <div>
                      <h2>Despertar e disponibilidade</h2>
                      <p>
                        O Mac acorda 5 minutos antes e permanece ativo durante a
                        execução.
                      </p>
                    </div>
                    <span className={`badge ${power ? "success" : "muted"}`}>
                      {power ? "Serviço disponível" : "Verificar serviço"}
                    </span>
                  </div>
                  <div className="inline">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          confirm(
                            "Instalar o serviço de despertar? O macOS solicitará uma autorização de administrador. O serviço só gerencia os despertares deste aplicativo.",
                          )
                        ) {
                          const result = await act(
                            "installWake",
                            {},
                            "Serviço instalado",
                          );
                          if (result) setPower(true);
                        }
                      }}
                    >
                      Instalar serviço de despertar
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        const result = await act(
                          "powerStatus",
                          {},
                          "Estado atualizado",
                        );
                        if (result) setPower(result.installed);
                      }}
                    >
                      Verificar
                    </button>
                  </div>
                  {data.wakeError && (
                    <p className="note">
                      O serviço de despertar está pendente. As execuções ainda
                      funcionam quando o Mac está acordado.
                    </p>
                  )}
                  <p className="note">
                    Mantenha o Mac ligado à energia, com a sessão iniciada e
                    acesso à rede. O serviço suporta repouso com a tampa aberta.
                    Não garante execução com o Mac desligado, sem rede ou
                    aguardando login do FileVault.
                  </p>
                </section>
                <section className="settingsCard">
                  <h2>Execução em segundo plano</h2>
                  <p>
                    O agente inicia com sua sessão pelo launchd. Fechar a janela
                    não interrompe os agendamentos.
                  </p>
                  <p className="note">
                    Mantenha o aplicativo no mesmo local após instalar. Os dados
                    são salvos em ~/Library/Application Support/Local Scheduler.
                    Perfis, memórias e histórico são locais.
                  </p>
                </section>
                <section className="settingsCard">
                  <h2>Módulos disponíveis</h2>
                  {data.modules.map((m) => (
                    <div key={m.id} className="moduleSetting">
                      <Icon name={m.id} />
                      <strong>{m.label}</strong>
                      <span>Versão {m.version}</span>
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
      {task && (
        <TaskModal
          task={task}
          setTask={setTask}
          profiles={data?.profiles ?? []}
          memories={data?.memories ?? []}
          busy={busy}
          error={setError}
          save={async (input, memoryName) => {
            if (memoryName) {
              const result = await act(
                "saveMemory",
                {
                  namespace: input.moduleId,
                  name: memoryName,
                  value: input.config,
                },
                "Memória salva",
              );
              if (!result) return;
            }
            const result = await act("saveTask", input, "Agendamento salvo");
            if (result) setTask(null);
          }}
        />
      )}
      {profile && (
        <ProfileModal
          profile={profile}
          setProfile={setProfile}
          profiles={data?.profiles ?? []}
          busy={busy}
          error={setError}
          save={async () => {
            const result = await act("saveProfile", profile, "Conexão salva");
            if (result) setProfile(null);
          }}
        />
      )}
      {run && (
        <Modal
          title={run.taskName}
          subtitle={statuses[run.status]}
          onClose={() => setRun(null)}
        >
          <div className="modalBody">
            <p>{run.summary}</p>
            <div className="grid2">
              <Field label="Agendado para">
                <span>{date(run.scheduledAt.split("#")[0])}</span>
              </Field>
              <Field label="Revisão">
                <span>{run.revision}</span>
              </Field>
            </div>
            <h3>Saída registrada</h3>
            <pre className="log">
              {logs.length
                ? logs.map((l) => `[${l.at}] ${l.stream}: ${l.text}`).join("\n")
                : "Nenhuma saída registrada."}
            </pre>
            {["running", "preparing"].includes(run.status) && (
              <button
                className="secondary danger"
                onClick={() =>
                  void act(
                    "cancelRun",
                    { id: run.id },
                    "Cancelamento solicitado",
                  )
                }
              >
                Cancelar execução
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskModal({
  task: t,
  setTask: set,
  profiles,
  memories,
  busy,
  error,
  save,
}: {
  task: TaskInput;
  setTask: (v: TaskInput | null) => void;
  profiles: Profile[];
  memories: Memory[];
  busy: boolean;
  error: (s: string) => void;
  save: (t: TaskInput, memory: string) => Promise<void>;
}) {
  const [memory, setMemory] = useState("");
  const editor = getEditor(t.moduleId),
    Editor = editor.component;
  const schedule = t.schedule;
  const patch = (v: any) => set({ ...t, ...v });
  const setSchedule = (v: any) => patch({ schedule: { ...schedule, ...v } });
  return (
    <Modal
      title={t.id ? "Editar agendamento" : "Novo agendamento"}
      subtitle="Configure a ação e escolha o horário."
      onClose={() => set(null)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (t.schedule.kind === "once" && !t.schedule.at) {
            error("Escolha a data e o horário.");
            return;
          }
          void save(t, memory);
        }}
      >
        <div className="modalBody">
          <Field label="Nome">
            <input
              required
              autoFocus
              value={t.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ex.: habilitar bateria adicional CPX"
            />
          </Field>
          <div className="moduleTabs">
            {listEditors().map((m) => (
              <button
                key={m.id}
                type="button"
                className={t.moduleId === m.id ? "active" : ""}
                onClick={() => patch({ moduleId: m.id, config: m.initial() })}
              >
                <Icon name={m.id} />
                <div>
                  <strong>{m.label}</strong>
                  <small>{m.description}</small>
                </div>
              </button>
            ))}
          </div>
          {memories.some((m) => m.namespace === t.moduleId) && (
            <Field label="Usar uma memória">
              <select
                defaultValue=""
                onChange={(e) => {
                  const m = memories.find((m) => m.id === e.target.value);
                  if (m) patch({ config: structuredClone(m.value) });
                }}
              >
                <option value="">Configurar manualmente</option>
                {memories
                  .filter((m) => m.namespace === t.moduleId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Editor
            config={t.config}
            setConfig={(v) => patch({ config: v })}
            profiles={profiles}
            error={error}
          />
          <div className="formDivider">
            <Icon name="clock" />
            <h3>Quando executar</h3>
          </div>
          <div className="grid2">
            <Field label="Frequência">
              <select
                value={schedule.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  patch({
                    schedule:
                      kind === "once"
                        ? { kind, timezone: schedule.timezone, at: "" }
                        : kind === "cron"
                          ? {
                              kind,
                              timezone: schedule.timezone,
                              expression: "0 8 * * 1",
                            }
                          : {
                              kind,
                              timezone: schedule.timezone,
                              time: "08:00",
                              ...(kind === "weekly" ? { weekdays: [1] } : {}),
                            },
                  });
                }}
              >
                <option value="once">Uma vez</option>
                <option value="daily">Todos os dias</option>
                <option value="weekly">Semanal</option>
                <option value="cron">Cron avançado</option>
              </select>
            </Field>
            <Field label="Fuso horário">
              <input
                required
                value={schedule.timezone}
                onChange={(e) => setSchedule({ timezone: e.target.value })}
              />
            </Field>
          </div>
          {schedule.kind === "once" ? (
            <Field label="Data e horário">
              <input
                required
                type="datetime-local"
                value={schedule.at}
                onChange={(e) => setSchedule({ at: e.target.value })}
              />
            </Field>
          ) : schedule.kind === "cron" ? (
            <Field
              label="Expressão cron"
              help="Minuto, hora, dia do mês, mês, dia da semana (0 a 6)."
            >
              <input
                required
                className="code"
                value={schedule.expression}
                onChange={(e) => setSchedule({ expression: e.target.value })}
              />
            </Field>
          ) : (
            <>
              <Field label="Horário">
                <input
                  required
                  type="time"
                  value={schedule.time}
                  onChange={(e) => setSchedule({ time: e.target.value })}
                />
              </Field>
              {schedule.kind === "weekly" && (
                <div className="weekdays">
                  {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                    (label, day) => (
                      <label
                        key={day}
                        className={
                          schedule.weekdays.includes(day) ? "active" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={schedule.weekdays.includes(day)}
                          onChange={(e) =>
                            setSchedule({
                              weekdays: e.target.checked
                                ? [...schedule.weekdays, day]
                                : schedule.weekdays.filter((d) => d !== day),
                            })
                          }
                        />
                        {label}
                      </label>
                    ),
                  )}
                </div>
              )}
            </>
          )}
          <div className="grid2">
            <Field
              label="Tolerância ao atraso (min)"
              help="Passada essa janela, a ação será marcada como não executada."
            >
              <input
                type="number"
                required
                min="0"
                max="1440"
                value={t.toleranceMinutes}
                onChange={(e) =>
                  patch({ toleranceMinutes: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Tempo limite (segundos)">
              <input
                type="number"
                required
                min="1"
                max="86400"
                value={t.timeoutSeconds}
                onChange={(e) =>
                  patch({ timeoutSeconds: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={t.wake}
              onChange={(e) => patch({ wake: e.target.checked })}
            />
            Despertar o Mac 5 minutos antes
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={t.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Agendamento ativo
          </label>
          <Field label="Salvar também como memória (opcional)">
            <input
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              placeholder="Nome da configuração para reutilizar"
            />
          </Field>
        </div>
        <footer className="modalFoot">
          <p>Ações não são repetidas automaticamente.</p>
          <button type="button" className="secondary" onClick={() => set(null)}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar agendamento"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function ProfileModal({
  profile: p,
  setProfile: set,
  profiles,
  busy,
  error,
  save,
}: {
  profile: any;
  setProfile: (v: any) => void;
  profiles: Profile[];
  busy: boolean;
  error: (s: string) => void;
  save: () => Promise<void>;
}) {
  const v = p.value;
  const patch = (value: any) => set({ ...p, value: { ...v, ...value } });
  return (
    <Modal
      title={p.kind === "ssh" ? "Conexão SSH" : "Banco PostgreSQL"}
      subtitle="Os dados ficam disponíveis nos seus agendamentos."
      onClose={() => set(null)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="modalBody">
          <Field label="Nome">
            <input
              required
              autoFocus
              value={p.name}
              onChange={(e) => set({ ...p, name: e.target.value })}
              placeholder="Ex.: produção"
            />
          </Field>
          <div className="grid2">
            <Field label="Host">
              <input
                required
                value={v.host}
                onChange={(e) => patch({ host: e.target.value })}
              />
            </Field>
            <Field label="Porta">
              <input
                required
                type="number"
                min="1"
                max="65535"
                value={v.port}
                onChange={(e) => patch({ port: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Usuário">
            <input
              required
              value={v.username}
              onChange={(e) => patch({ username: e.target.value })}
            />
          </Field>
          {p.kind === "ssh" ? (
            <>
              <Field label="Autenticação">
                <select
                  value={v.auth}
                  onChange={(e) => patch({ auth: e.target.value })}
                >
                  <option value="key">Chave privada</option>
                  <option value="password">Senha</option>
                  <option value="agent">SSH agent da sessão</option>
                </select>
              </Field>
              {v.auth === "key" && (
                <>
                  <FileField
                    label="Chave privada"
                    kind="key"
                    value={v.keyPath}
                    onChange={(s) => patch({ keyPath: s })}
                    error={error}
                  />
                  <Field label="Passphrase da chave">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={p.passphrase}
                      onChange={(e) =>
                        set({ ...p, passphrase: e.target.value })
                      }
                      placeholder={
                        p.id
                          ? "Deixe vazio para manter"
                          : "Se a chave for protegida"
                      }
                    />
                  </Field>
                </>
              )}
              {v.auth === "password" && (
                <Field label="Senha">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={p.password}
                    onChange={(e) => set({ ...p, password: e.target.value })}
                    placeholder={p.id ? "Deixe vazio para manter" : ""}
                  />
                </Field>
              )}
              <Field
                label="Fingerprint do servidor"
                help="Depois de salvar, use Testar conexão para obter e confirmar o fingerprint."
              >
                <input
                  value={v.fingerprint ?? ""}
                  onChange={(e) => patch({ fingerprint: e.target.value })}
                  placeholder="SHA256:..."
                />
              </Field>
              {v.auth === "agent" && (
                <p className="note">
                  O SSH agent precisa estar disponível para o processo em
                  segundo plano. Para execução sem interação, prefira uma chave
                  salva com passphrase no Keychain.
                </p>
              )}
            </>
          ) : (
            <>
              <Field label="Banco">
                <input
                  required
                  value={v.database}
                  onChange={(e) => patch({ database: e.target.value })}
                  placeholder="subscriptions"
                />
              </Field>
              <Field label="Senha">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={p.password}
                  onChange={(e) => set({ ...p, password: e.target.value })}
                  placeholder={p.id ? "Deixe vazio para manter" : ""}
                />
              </Field>
              <Field label="Túnel SSH">
                <select
                  value={v.sshProfileId ?? ""}
                  onChange={(e) => patch({ sshProfileId: e.target.value })}
                >
                  <option value="">Sem túnel</option>
                  {profiles
                    .filter((p) => p.kind === "ssh")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="TLS">
                <select
                  value={v.tls}
                  onChange={(e) => patch({ tls: e.target.value })}
                >
                  <option value="verify">Validar certificado e hostname</option>
                  <option value="disable">Sem TLS</option>
                </select>
              </Field>
              <FileField
                label="Certificado CA (opcional)"
                kind="ca"
                value={v.caPath ?? ""}
                onChange={(s) => patch({ caPath: s })}
                error={error}
              />
            </>
          )}
        </div>
        <footer className="modalFoot">
          <p>Credenciais protegidas pelo Keychain.</p>
          <button type="button" className="secondary" onClick={() => set(null)}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar conexão"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
