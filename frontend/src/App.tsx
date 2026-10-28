import FilePreview, { type PreviewTarget } from "./components/FilePreview";
import SystemIcon, { hasSystemIcon } from "./components/SystemIcon";
import ThemeSwitch from "./components/ThemeSwitch";
import RefreshGamelistNote from "./components/RefreshGamelistNote";
import LibraryInfo from "./components/LibraryInfo";
import FileBrowser from "./components/FileBrowser";
import { type Entry, systems, systemName, bytes, join } from "./library";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Star,
  ChevronLeft,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleX,
  CloudUpload,
  File,
  FolderPlus,
  FolderSearch,
  Gamepad2,
  HardDrive,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Menu,
  MonitorSmartphone,
  Network,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";

type Status = {
  connected: boolean;
  host?: string;
  generation?: string;
  storage?: { total: number; used: number; free: number };
};
type Job = {
  id: string;
  file: globalThis.File;
  path: string;
  generation: string;
  progress: number;
  state: "queued" | "uploading" | "done" | "error" | "cancelled";
  message?: string;
};
type Ask = {
  title: string;
  description: string;
  initial?: string;
  confirm: string;
  danger?: boolean;
  resolve: (value: string | null) => void;
};
class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(
      typeof detail === "string"
        ? detail
        : "Não foi possível concluir o pedido.",
    );
  }
}
async function api<T = Record<string, unknown>>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ detail: "A ligação ao PC foi interrompida." }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      typeof data.detail === "string" &&
      data.detail.includes("código de acesso")
    )
      window.dispatchEvent(new Event("romdock-auth-expired"));
    throw new ApiError(response.status, data.detail);
  }
  return data;
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-symbol">
        <Gamepad2 size={23} strokeWidth={2.4} />
      </div>
      <span>
        ROM<span className="brand-light">DOCK</span>
        <small>GESTÃO LOCAL DE FICHEIROS.</small>
      </span>
    </div>
  );
}
function ConsoleArt() {
  return (
    <div className="console-art" aria-hidden="true">
      <div className="handheld">
        <div className="console-top">
          <i />
          <span>ANBERNIC</span>
          <i />
        </div>
        <div className="screen-frame">
          <div className="console-screen">
            <div className="pixel-star">✦</div>
            <span>ROM DOCK</span>
            <div className="pixel-line" />
          </div>
        </div>
        <div className="console-controls">
          <div className="dpad">
            <b />
            <i />
          </div>
          <div className="face-buttons">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="console-bottom">
          <span>RG40XX V</span>
          <div>|||||</div>
        </div>
      </div>
      <span className="art-orbit orbit-one" />
      <span className="art-orbit orbit-two" />
    </div>
  );
}
function Dialog({ request }: { request: Ask }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(request.initial ?? "");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        request.resolve(null);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          request.resolve(request.initial === undefined ? "yes" : value);
        }}
      >
        <div className="dialog-icon">
          {request.danger ? <Trash2 /> : <ShieldCheck />}
        </div>
        <button
          type="button"
          aria-label="Fechar diálogo"
          className="icon-button dialog-close"
          onClick={() => request.resolve(null)}
        >
          <X size={19} />
        </button>
        <h2>{request.title}</h2>
        <p className="dialog-description">{request.description}</p>
        {request.initial !== undefined && (
          <label className="field">
            Nome
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              maxLength={255}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => request.resolve(null)}
          >
            Cancelar
          </button>
          <button
            className={`button ${request.danger ? "danger" : "primary"}`}
            autoFocus={request.initial === undefined}
          >
            {request.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [access, setAccess] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ connected: false }),
    [path, setPath] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [roots, setRoots] = useState<Entry[]>([]);
  const [collapsed, setCollapsed] = useState(() => {
      try {
        return localStorage.getItem("romdock-sidebar-collapsed") === "true";
      } catch {
        return false;
      }
    }),
    [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [infoCollapsed, setInfoCollapsed] = useState(() => {
    try {
      return localStorage.getItem("romdock-info-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("romdock-favorites") || "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((name): name is string => typeof name === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [systemFilter, setSystemFilter] = useState("all");
  const [systemRoms, setSystemRoms] = useState<Record<string, boolean | null>>(
    {},
  );
  const [scanningSystems, setScanningSystems] = useState(false);
  const [systemScanError, setSystemScanError] = useState("");
  function toggleInfo(value: boolean) {
    setInfoCollapsed(value);
    try {
      localStorage.setItem("romdock-info-collapsed", String(value));
    } catch {}
  }
  function favorite(name: string) {
    setFavorites((current) => {
      const next = current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name];
      try {
        localStorage.setItem("romdock-favorites", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const touchStart = useRef<{
    x: number;
    y: number;
    time: number;
    edge: "left" | "right";
  } | null>(null);
  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem("romdock-sidebar-collapsed", String(!value));
      } catch {}
      return !value;
    });
  }
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [mobile, setMobile] = useState(false),
    [showConnection, setShowConnection] = useState(false),
    [connectionBusy, setConnectionBusy] = useState(false),
    [connectionError, setConnectionError] = useState("");
  const [host, setHost] = useState(""),
    [port, setPort] = useState("22"),
    [username, setUsername] = useState("root"),
    [password, setPassword] = useState("");
  const [history, setHistory] = useState<string[]>([""]),
    [historyIndex, setHistoryIndex] = useState(0);
  const [informationOpen, setInformationOpen] = useState(false),
    [selection, setSelection] = useState<Entry | null>(null);
  const [dialog, setDialog] = useState<Ask | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [showTransfers, setShowTransfers] = useState(true),
    [drag, setDrag] = useState(false),
    [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null),
    queue = useRef<Job[]>([]),
    running = useRef(false),
    xhrRef = useRef<XMLHttpRequest | null>(null),
    activeJob = useRef<Job | null>(null),
    [revision, setRevision] = useState(0);
  const ask = (options: Omit<Ask, "resolve">) =>
    new Promise<string | null>((resolve) =>
      setDialog({
        ...options,
        resolve: (value) => {
          setDialog(null);
          resolve(value);
        },
      }),
    );
  const notify = (message: string) => {
    setToast(message);
  };
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const expire = () => setAuth(false);
    window.addEventListener("romdock-auth-expired", expire);
    return () => window.removeEventListener("romdock-auth-expired", expire);
  }, []);
  useEffect(() => {
    api<Status>("/status")
      .then((s) => {
        setStatus(s);
        setAuth(true);
      })
      .catch((e) => {
        if (e.status === 401) setAuth(false);
        else {
          setAuth(true);
          setError(e.message);
        }
      });
  }, []);
  useEffect(() => {
    if (!auth || !status.connected) return;
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    setError("");
    api<{ entries: Entry[] }>("/files?path=" + encodeURIComponent(path))
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setSelection((current) =>
          current
            ? data.entries.find((entry) => entry.name === current.name) || null
            : null,
        );
        if (!path)
          setRoots(data.entries.filter((e) => e.directory && !e.symlink));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth, status.connected, status.generation, path, revision]);
  useEffect(() => {
    if (auth && status.connected)
      api<Status>("/status")
        .then(setStatus)
        .catch(() => {});
  }, [auth, status.connected, revision]);
  const needsSystemScan = systemFilter !== "all";
  useEffect(() => {
    setSystemRoms({});
    setSystemScanError("");
    if (!auth || !status.connected || !needsSystemScan) {
      setScanningSystems(false);
      return;
    }
    const abort = new AbortController();
    setScanningSystems(true);
    api<{ systems: Record<string, boolean | null> }>(
      "/systems?generation=" + encodeURIComponent(status.generation || ""),
      { signal: abort.signal },
    )
      .then((data) => {
        if (!abort.signal.aborted) setSystemRoms(data.systems || {});
      })
      .catch((error) => {
        if (!abort.signal.aborted) setSystemScanError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setScanningSystems(false);
      });
    return () => abort.abort();
  }, [auth, status.connected, status.generation, needsSystemScan, revision]);
  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      await api("/login", {
        method: "POST",
        body: JSON.stringify({ code: access }),
      });
      setAccess("");
      setAuth(true);
      setStatus(await api<Status>("/status"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }
  async function connect(e: FormEvent) {
    e.preventDefault();
    setConnectionBusy(true);
    setConnectionError("");
    setError("");
    const body = {
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      password,
    };
    try {
      let next: Status;
      try {
        next = await api<Status>("/connect", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } catch (e) {
        const failure = e as ApiError;
        const detail = failure.detail as {
          type?: string;
          fingerprint: string;
          changed: boolean;
        };
        if (detail?.type !== "host_key") throw e;
        const accepted = await ask({
          title: detail.changed
            ? "A identidade SSH mudou"
            : "Confirmar a consola",
          description: `${detail.changed ? "A chave é diferente da anteriormente guardada. Confirmar a alteração antes de continuar." : "Primeira ligação a " + body.host + ". Confirmar a identidade da consola."}\n\nImpressão digital SSH:\n${detail.fingerprint}`,
          confirm: detail.changed ? "Confiar na nova chave" : "Confiar e ligar",
          danger: detail.changed,
        });
        if (!accepted) return;
        next = await api<Status>("/connect", {
          method: "POST",
          body: JSON.stringify({ ...body, accepted_key: detail.fingerprint }),
        });
      }
      setStatus(next);
      setHistory([""]);
      setHistoryIndex(0);
      setSelection(null);
      setInformationOpen(false);
      setPassword("");
      setShowConnection(false);
      setPath("");
      setRoots([]);
      setEntries([]);
      refresh();
      notify("Ligação à consola estabelecida.");
    } catch (e) {
      setConnectionError((e as Error).message);
    } finally {
      setConnectionBusy(false);
    }
  }
  function navigate(next: string) {
    if (next !== path) {
      setHistory((current) => [...current.slice(0, historyIndex + 1), next]);
      setHistoryIndex(historyIndex + 1);
    }
    setSelection(null);
    setInformationOpen(false);
    setPath(next);
    setMobile(false);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || document.querySelector("dialog[open]")) return;
      const element = event.target as HTMLElement;
      if (element.matches("input,textarea,select") || element.isContentEditable)
        return;
      if (event.key === "ArrowLeft" && historyIndex > 0) {
        event.preventDefault();
        travel(historyIndex - 1);
      }
      if (event.key === "ArrowRight" && historyIndex < history.length - 1) {
        event.preventDefault();
        travel(historyIndex + 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [historyIndex, history]);
  const generation = status.generation || "";
  async function createFolder() {
    const name = await ask({
      title: "Nova pasta",
      description: "A pasta será criada na localização atual da consola.",
      initial: "",
      confirm: "Criar pasta",
    });
    if (!name) return;
    try {
      await api("/folder", {
        method: "POST",
        body: JSON.stringify({ path: join(path, name), generation }),
      });
      refresh();
      notify("Pasta criada.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function rename(entry: Entry) {
    const name = await ask({
      title: "Renomear",
      description: entry.name,
      initial: entry.name,
      confirm: "Guardar nome",
    });
    if (!name || name === entry.name) return;
    try {
      await api("/rename", {
        method: "POST",
        body: JSON.stringify({
          path: join(path, entry.name),
          name,
          generation,
        }),
      });
      refresh();
      notify("Nome atualizado.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(entry: Entry) {
    if (
      !(await ask({
        title: entry.directory ? "Eliminar pasta?" : "Eliminar ficheiro?",
        description: `${entry.name}\n\nEsta operação elimina o ${entry.directory ? "diretório, se estiver vazio" : "ficheiro"} da consola e não pode ser desfeita.`,
        confirm: "Eliminar",
        danger: true,
      }))
    )
      return;
    try {
      await api(
        "/entry?" +
          new URLSearchParams({ path: join(path, entry.name), generation }),
        { method: "DELETE" },
      );
      refresh();
      notify("Eliminado da consola.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download(entry: Entry) {
    // A same-origin frame lets the browser stream large attachments to disk while
    // keeping JSON errors inside the application rather than replacing the page.
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Download de " + entry.name;
    const cleanup = () => frame.remove();
    const timer = window.setTimeout(cleanup, 120000);
    frame.onload = () => {
      try {
        const text = frame.contentDocument?.body?.textContent;
        if (!text) return;
        const data = JSON.parse(text);
        if (data.detail) {
          setError(
            typeof data.detail === "string"
              ? data.detail
              : "Não foi possível descarregar o ficheiro.",
          );
          if (String(data.detail).includes("código de acesso")) setAuth(false);
        }
      } catch {
        setError(
          "Não foi possível descarregar o ficheiro. Verifica a ligação ao PC.",
        );
      } finally {
        if (frame.contentDocument?.body?.textContent) {
          clearTimeout(timer);
          cleanup();
        }
      }
    };
    frame.onerror = () => {
      clearTimeout(timer);
      cleanup();
      setError("A ligação ao PC foi interrompida durante o download.");
    };
    frame.src =
      "/api/download?" +
      new URLSearchParams({ path: join(path, entry.name), generation });
    document.body.appendChild(frame);
  }
  const updateJob = (job: Job, patch: Partial<Job>) => {
    Object.assign(job, patch);
    setJobs((current) =>
      current.map((j) => (j.id === job.id ? { ...job } : j)),
    );
  };
  function send(job: Job, overwrite: boolean) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open(
        "PUT",
        "/api/upload?" +
          new URLSearchParams({
            path: job.path,
            generation: job.generation,
            overwrite: String(overwrite),
          }),
      );
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          updateJob(job, {
            progress: Math.min(99, Math.round((e.loaded / e.total) * 100)),
          });
      };
      xhr.onload = () => {
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = { detail: "O PC devolveu uma resposta inesperada." };
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new ApiError(xhr.status, data.detail));
      };
      xhr.onerror = () =>
        reject(
          new Error("Ligação interrompida. O ficheiro não foi concluído."),
        );
      xhr.onabort = () => reject(new Error("Envio cancelado."));
      xhr.send(job.file);
    });
  }
  async function pump() {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const job = queue.current.shift()!;
      if (job.state === "cancelled") continue;
      activeJob.current = job;
      updateJob(job, { state: "uploading" });
      try {
        try {
          await send(job, false);
        } catch (e) {
          if (
            e instanceof ApiError &&
            e.status === 409 &&
            e.message.includes("existe")
          ) {
            const replace = await ask({
              title: "Substituir ficheiro?",
              description: `${job.file.name}\n\nJá existe um ficheiro com este nome. A substituição só é feita depois de o envio terminar.`,
              confirm: "Substituir",
              danger: true,
            });
            if (!replace) {
              updateJob(job, {
                state: "cancelled",
                message: "Substituição cancelada.",
              });
              continue;
            }
            await send(job, true);
          } else throw e;
        }
        updateJob(job, { state: "done", progress: 100 });
      } catch (e) {
        updateJob(job, {
          state:
            activeJob.current?.state === "cancelled" ? "cancelled" : "error",
          message: (e as Error).message,
        });
      } finally {
        xhrRef.current = null;
        activeJob.current = null;
      }
    }
    running.current = false;
    refresh();
  }
  function addFiles(files: FileList | globalThis.File[] | null) {
    if (!files?.length || !status.connected) return;
    const added = Array.from(files).map((file) => ({
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
      file,
      path: join(path, file.name),
      generation,
      progress: 0,
      state: "queued" as const,
    }));
    queue.current.push(...added);
    setJobs((current) => [...current, ...added]);
    setShowTransfers(true);
    void pump();
  }
  function cancelJob(job: Job) {
    const active = job.state === "uploading";
    updateJob(job, { state: "cancelled", message: "Envio cancelado." });
    const queued = queue.current.find((j) => j.id === job.id);
    if (queued) queued.state = "cancelled";
    if (active) {
      if (activeJob.current) activeJob.current.state = "cancelled";
      xhrRef.current?.abort();
    }
  }
  const activeJobs = jobs.filter(
    (j) => j.state === "uploading" || j.state === "queued",
  ).length;
  const currentName = path
    ? systemName(path.split("/").at(-1)!)
    : "Biblioteca de ROMs";
  const rootSystem = path.split("/")[0];
  const popular = [
    "snes",
    "gba",
    "gb",
    "gbc",
    "nes",
    "megadrive",
    "psx",
    "psp",
    "arcade",
    "neogeo",
  ];
  const sortedRoots = [...roots].sort((a, b) => {
    const ai = popular.indexOf(a.name),
      bi = popular.indexOf(b.name);
    return (
      (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.name.localeCompare(b.name)
    );
  });
  const matchesSystem = (entry: Entry) =>
    systemFilter === "all" ||
    systemRoms[entry.name] === (systemFilter === "with");
  const filteredRoots = sortedRoots.filter(matchesSystem);
  const visibleEntries =
    !path && systemFilter !== "all"
      ? entries.filter((entry) => entry.directory && matchesSystem(entry))
      : entries;
  const systemRow = (entry: Entry) => (
    <div className="system-row" key={entry.name}>
      <button
        className={`system-nav ${rootSystem === entry.name ? "active" : ""}`}
        title={systemName(entry.name)}
        aria-label={systemName(entry.name)}
        onClick={() => navigate(entry.name)}
      >
        {hasSystemIcon(entry.name) ? (
          <SystemIcon system={entry.name} />
        ) : (
          <FolderPlus size={16} />
        )}
        <span>{systemName(entry.name)}</span>
      </button>
      <button
        className={`favorite-system ${favorites.includes(entry.name) ? "is-favorite" : ""}`}
        aria-label={`${favorites.includes(entry.name) ? "Remover dos" : "Adicionar aos"} favoritos: ${systemName(entry.name)}`}
        aria-pressed={favorites.includes(entry.name)}
        title="Favorito"
        onClick={() => favorite(entry.name)}
      >
        <Star size={14} />
      </button>
    </div>
  );
  const used = status.storage
    ? (status.storage.used / status.storage.total) * 100
    : 0;
  const connectionForm = (
    <form className="connection-form" onSubmit={connect}>
      <div className="eyebrow">
        <span className="tiny-square" /> LIGAÇÃO À CONSOLA
      </div>
      <h2>Configurar ligação</h2>
      <p>
        Dados de acesso SSH à consola. As transferências são efetuadas pelo PC.
      </p>
      <div className="form-row">
        <label className="field">
          Endereço IP
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
            autoComplete="off"
            placeholder="192.168.1.100"
          />
        </label>
        <label className="field port-field">
          Porta
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            required
            type="number"
            min="1"
            max="65535"
          />
        </label>
      </div>
      <label className="field">
        Utilizador
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
        />
      </label>
      <label className="field">
        Palavra-passe SSH
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="A palavra-passe da consola"
        />
      </label>
      {connectionError && (
        <div className="inline-error" role="alert">
          <CircleX size={17} />
          {connectionError}
        </div>
      )}
      <button
        className="button primary full"
        disabled={connectionBusy || activeJobs > 0}
      >
        {connectionBusy ? (
          <LoaderCircle className="spin" size={18} />
        ) : (
          <Plug size={18} />
        )}{" "}
        {connectionBusy ? "A ligar…" : "Ligar à consola"}
      </button>
      <p className="form-note">
        <ShieldCheck size={15} /> A palavra-passe fica apenas na memória do PC.
      </p>
    </form>
  );
  if (auth === null)
    return (
      <div className="initial-loading">
        <LoaderCircle className="spin" /> A iniciar a aplicação…
      </div>
    );
  if (!auth)
    return (
      <main className="login-page">
        <div className="login-nav">
          <Brand />
          <ThemeSwitch />
          <span className="version">GESTOR DE ROMS / V1.0</span>
        </div>
        <div className="login-layout">
          <section className="login-intro">
            <div className="eyebrow">
              <span className="tiny-square" /> GESTÃO DE FICHEIROS EM REDE
            </div>
            <h1>
              Gestão de ROMs.
              <br />
              <span>Acesso local.</span>
            </h1>
            <p>
              Consultar, organizar e transferir ficheiros entre dispositivos na
              rede local.
            </p>
            <ConsoleArt />
            <div className="login-features">
              <span>
                <Wifi size={16} /> Rede local
              </span>
              <span>
                <MonitorSmartphone size={16} /> PC e telemóvel
              </span>
            </div>
          </section>
          <section className="login-card">
            <div className="login-card-icon">
              <ShieldCheck size={27} />
            </div>
            <h2>Acesso à aplicação</h2>
            <p>
              Utilizar o código apresentado no terminal do PC para aceder à
              biblioteca.
            </p>
            <form onSubmit={login}>
              <label className="field">
                Código de acesso
                <input
                  value={access}
                  onChange={(e) => setAccess(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder="Código apresentado no terminal"
                />
              </label>
              {error && (
                <div className="inline-error" role="alert">
                  {error}
                </div>
              )}
              <button className="button primary full" disabled={loginBusy}>
                {loginBusy ? <LoaderCircle className="spin" size={18} /> : null}
                Entrar no ROM Dock <ArrowUpRight size={18} />
              </button>
            </form>
            <div className="login-card-footer">
              <Network size={16} />
              <span>Acesso restrito à rede local.</span>
            </div>
          </section>
        </div>
        <footer className="login-footer">
          GESTÃO DE FICHEIROS · ROCKNIX<span>ROM DOCK · ROCKNIX</span>
        </footer>
      </main>
    );
  function travel(index: number) {
    setHistoryIndex(index);
    setPath(history[index]);
    setSelection(null);
    setInformationOpen(false);
  }
  return (
    <div
      className={`finder-shell ${infoCollapsed ? "info-collapsed" : ""} ${!status.connected ? "setup-mode" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <Brand />
        <div className="finder-sidebar-label">LOCALIZAÇÕES</div>
        <button
          className={`finder-location ${!path ? "active" : ""}`}
          aria-label="ROMs"
          title="ROMs"
          onClick={() => navigate("")}
        >
          <HardDrive size={17} />
          <span>ROMs</span>
          <span className="finder-count">{roots.length || "—"}</span>
        </button>
        <label className="sidebar-system-filter">
          <span>Filtrar sistemas</span>
          <select
            aria-label="Filtrar sistemas"
            value={systemFilter}
            onChange={(event) => setSystemFilter(event.target.value)}
          >
            <option value="all">Todos os sistemas</option>
            <option value="with">Com ROMs</option>
            <option value="without">Sem ROMs</option>
          </select>
        </label>
        {favorites.length > 0 && (
          <>
            <div className="finder-sidebar-label favorites-label">
              FAVORITOS
            </div>
            <nav className="favorites-nav" aria-label="Sistemas favoritos">
              {filteredRoots
                .filter((entry) => favorites.includes(entry.name))
                .map(systemRow)}
            </nav>
          </>
        )}
        <div className="finder-sidebar-label">SISTEMAS</div>
        <nav className="systems-nav" aria-label="Sistemas">
          {filteredRoots
            .filter((entry) => !favorites.includes(entry.name))
            .slice(0, 7)
            .map(systemRow)}
        </nav>
        {scanningSystems && (
          <span className="sidebar-scan-status" role="status">
            A verificar ROMs…
          </span>
        )}
        {systemScanError && (
          <span className="sidebar-scan-status" role="alert">
            {systemScanError}
          </span>
        )}
        <button
          className="finder-all"
          aria-label="Ver todos os sistemas"
          onClick={() => {
            setSystemFilter("all");
            navigate("");
          }}
        >
          Ver todos os sistemas
          <ChevronRight size={13} />
        </button>
        <div className="finder-sidebar-bottom">
          <div className="finder-theme-setting">
            <span>Tema</span>
            <ThemeSwitch />
          </div>
          <div className="finder-connection">
            <span className="online-dot" />
            <span>{status.host || "Consola por ligar"}</span>
          </div>
          {status.storage && (
            <>
              <div className="storage-track">
                <i style={{ width: `${used}%` }} />
              </div>
              <span className="finder-storage">
                {bytes(status.storage.free)} disponíveis
              </span>
            </>
          )}
          <button
            className="finder-settings"
            onClick={() => setShowConnection(true)}
          >
            <SlidersHorizontal size={15} />
            Configurar ligação
          </button>
        </div>
      </aside>
      <div className="finder-window">
        <header className="finder-toolbar">
          <button
            className="icon-button desktop-sidebar-toggle panel-toggle"
            aria-label={
              collapsed ? "Expandir barra lateral" : "Encolher barra lateral"
            }
            aria-expanded={!collapsed}
            onClick={toggleSidebar}
          >
            {collapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
            <span>Navegação</span>
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir menu"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <div className="finder-history">
            <button
              className="icon-button"
              aria-label="Retroceder"
              title="Retroceder (Alt + ←)"
              disabled={historyIndex === 0}
              onClick={() => travel(historyIndex - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Avançar"
              title="Avançar (Alt + →)"
              disabled={historyIndex >= history.length - 1}
              onClick={() => travel(historyIndex + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="finder-title">
            <h1>{currentName}</h1>
            <span>{status.host || "Sem ligação"}</span>
          </div>
          <div className="finder-toolbar-actions">
            <button
              className="button secondary"
              disabled={!status.connected}
              onClick={() => void createFolder()}
            >
              <FolderPlus size={17} />
              <span>Nova pasta</span>
            </button>
            <button
              className="button primary"
              disabled={!status.connected}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={17} />
              <span>Enviar ficheiros</span>
            </button>
            <button
              className="icon-button desktop-info-toggle panel-toggle"
              aria-label={
                infoCollapsed ? "Expandir informação" : "Encolher informação"
              }
              aria-expanded={!infoCollapsed}
              onClick={() => toggleInfo(!infoCollapsed)}
            >
              {infoCollapsed ? (
                <PanelRightOpen size={19} />
              ) : (
                <PanelRightClose size={19} />
              )}
              <span>Informação</span>
            </button>
            <button
              className={`icon-button ${informationOpen ? "active" : ""}`}
              aria-label="Informação"
              aria-pressed={informationOpen}
              onClick={() => {
                toggleInfo(!infoCollapsed);
                setInformationOpen(!informationOpen);
              }}
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="icon-button finder-transfers-button"
              aria-label="Transferências"
              onClick={() => {
                setShowTransfers(!showTransfers);
                if (!jobs.length) notify("Sem transferências nesta sessão.");
              }}
            >
              <ArrowUpRight size={19} />
              {activeJobs > 0 && <b>{activeJobs}</b>}
            </button>
            <button
              className="icon-button finder-logout"
              aria-label="Terminar sessão"
              disabled={activeJobs > 0}
              onClick={async () => {
                await api("/logout", { method: "POST" });
                setAuth(false);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main
          className={`content finder-main ${drag ? "dragging" : ""}`}
          onTouchStart={(event) => {
            if (
              innerWidth > 760 ||
              document.querySelector("dialog[open]") ||
              event.touches.length !== 1
            )
              return;
            const touch = event.touches[0],
              bounds = event.currentTarget.getBoundingClientRect();
            const edge =
              touch.clientX < bounds.left + 32
                ? "left"
                : touch.clientX > bounds.right - 32
                  ? "right"
                  : null;
            touchStart.current = edge
              ? { x: touch.clientX, y: touch.clientY, time: Date.now(), edge }
              : null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            touchStart.current = null;
            const end = event.changedTouches[0];
            if (
              !start ||
              !end ||
              Date.now() - start.time > 800 ||
              Math.abs(end.clientY - start.y) > 55
            )
              return;
            const dx = end.clientX - start.x;
            if (start.edge === "left" && dx > 90 && historyIndex > 0)
              travel(historyIndex - 1);
            if (
              start.edge === "right" &&
              dx < -90 &&
              historyIndex < history.length - 1
            )
              travel(historyIndex + 1);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (status.connected) setDrag(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            ref={fileInput}
            className="visually-hidden"
            aria-label="Selecionar ficheiros para enviar"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {error && (
            <div className="error-banner" role="alert">
              <CircleX size={17} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Fechar erro"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!status.connected ? (
            <section className="connection-page">
              <header className="connection-page-header">
                <Brand />
                <ThemeSwitch />
              </header>
              <div className="connection-page-layout">
                <section className="connection-guide">
                  <div className="connection-device">
                    <Gamepad2 size={48} strokeWidth={1.4} />
                  </div>
                  <span className="connection-state">
                    <span />
                    Sem ligação à consola
                  </span>
                  <h1>Ligar a consola</h1>
                  <p>Aceder aos ficheiros da consola através da rede local.</p>
                  <dl className="connection-device-details">
                    <div>
                      <dt>Dispositivo</dt>
                      <dd>Anbernic RG40XX V</dd>
                    </div>
                    <div>
                      <dt>Sistema</dt>
                      <dd>ROCKNIX</dd>
                    </div>
                    <div>
                      <dt>Transferência</dt>
                      <dd>SFTP · SSH</dd>
                    </div>
                  </dl>
                  <div className="connection-checklist">
                    <h3>Antes de ligar</h3>
                    <ol>
                      <li>Manter o PC e a consola na mesma rede.</li>
                      <li>Ativar o serviço SSH nas definições da consola.</li>
                      <li>Confirmar o endereço IP nas informações de rede.</li>
                    </ol>
                  </div>
                </section>
                <div className="connection-page-card">{connectionForm}</div>
              </div>
              <footer className="connection-page-footer">
                <ShieldCheck size={15} /> Ligação direta entre o PC e a consola,
                na rede local.
              </footer>
            </section>
          ) : (
            <div className="library-layout has-preview">
              <div className="library-content">
                <FileBrowser
                  key={path}
                  path={path}
                  generation={generation}
                  revision={revision}
                  entries={visibleEntries}
                  loading={loading || (!path && scanningSystems)}
                  loadError={error || (!path ? systemScanError : "")}
                  onNavigate={navigate}
                  onRefresh={refresh}
                  onInspect={(entry) => {
                    setSelection(entry);
                    setInformationOpen(true);
                    toggleInfo(false);
                  }}
                  onDownload={download}
                  onPreview={(entry) =>
                    setPreview({
                      path: path ? `${path}/${entry.name}` : entry.name,
                      generation,
                      entry,
                    })
                  }
                  onRename={(entry) => void rename(entry)}
                  onDelete={(entry) => void remove(entry)}
                />
              </div>
              <LibraryInfo
                status={status}
                onChanged={refresh}
                path={path}
                entries={entries}
                selection={selection}
                revision={revision}
                collapsed={infoCollapsed}
                onToggle={() => toggleInfo(!infoCollapsed)}
                open={informationOpen}
                onClose={() => setInformationOpen(false)}
                onNavigate={navigate}
                onDownload={download}
                transfers={jobs.map((job) => ({
                  id: job.id,
                  name: job.file.name,
                  state: job.state,
                  progress: job.progress,
                }))}
                onTransfers={() => {
                  setInformationOpen(false);
                  setShowTransfers(true);
                  if (!jobs.length) notify("Sem transferências nesta sessão.");
                }}
              />
            </div>
          )}
          {drag && (
            <div className="drag-overlay">
              <CloudUpload size={42} />
              <h2>Enviar ficheiros</h2>
              <p>Destino: /roms{path ? "/" + path : ""}</p>
            </div>
          )}
        </main>
        <footer className="finder-statusbar">
          <span>{loading ? "A consultar…" : `${entries.length} itens`}</span>
          <span>
            {status.storage
              ? bytes(status.storage.free) + " disponíveis"
              : "Sem ligação à consola"}
          </span>
          <button onClick={() => setShowConnection(true)}>
            <span className="online-dot" />
            {status.connected ? "SFTP ligado" : "Configurar ligação"}
          </button>
        </footer>
      </div>
      {preview && (
        <FilePreview
          target={preview}
          onClose={() => setPreview(null)}
          onDownload={() => {
            const anchor = document.createElement("a");
            anchor.href =
              "/api/download?" +
              new URLSearchParams({
                path: preview.path,
                generation: preview.generation,
              });
            anchor.download = preview.entry.name;
            anchor.target = "_blank";
            anchor.rel = "noopener";
            anchor.click();
          }}
        />
      )}
      {jobs.length > 0 && (
        <aside
          className={`transfer-panel ${showTransfers ? "" : "collapsed"}`}
          aria-label="Transferências"
        >
          <button
            className="transfer-header"
            onClick={() => setShowTransfers(!showTransfers)}
          >
            <span>
              {activeJobs ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <CheckCheck size={18} />
              )}
              Transferências <b>{activeJobs || jobs.length}</b>
            </span>
            <ChevronDown size={17} className={!showTransfers ? "rotate" : ""} />
          </button>
          {showTransfers && (
            <>
              <div className="transfer-jobs">
                {jobs.map((job) => (
                  <div className="transfer-job" key={job.id}>
                    <div className={"job-icon " + job.state}>
                      {job.state === "done" ? (
                        <Check size={18} />
                      ) : job.state === "error" ? (
                        <CircleX size={18} />
                      ) : (
                        <File size={18} />
                      )}
                    </div>
                    <div className="job-info">
                      <strong>{job.file.name}</strong>
                      <span>
                        {job.state === "queued"
                          ? "Na fila"
                          : job.state === "done"
                            ? "Na consola · " + bytes(job.file.size)
                            : job.state === "error" || job.state === "cancelled"
                              ? job.message
                              : job.progress >= 99
                                ? "A guardar na consola…"
                                : `${job.progress}% · ${bytes(job.file.size)}`}
                      </span>
                      {job.state === "uploading" && (
                        <div className="job-progress">
                          <i style={{ width: `${job.progress}%` }} />
                        </div>
                      )}
                    </div>
                    {["queued", "uploading"].includes(job.state) && (
                      <button
                        className="icon-button"
                        aria-label={"Cancelar " + job.file.name}
                        onClick={() => cancelJob(job)}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {jobs.some((job) => job.state === "done") && (
                <RefreshGamelistNote />
              )}
              {!activeJobs && (
                <button className="clear-transfers" onClick={() => setJobs([])}>
                  Limpar concluídas
                </button>
              )}
            </>
          )}
        </aside>
      )}
      {showConnection && (
        <dialog open className="connection-modal">
          <div
            className="connection-modal-backdrop"
            onClick={() => !connectionBusy && setShowConnection(false)}
          />
          <div className="connection-modal-card">
            <button
              className="icon-button dialog-close"
              aria-label="Fechar configuração"
              onClick={() => setShowConnection(false)}
              disabled={connectionBusy}
            >
              <X size={19} />
            </button>
            {connectionForm}
          </div>
        </dialog>
      )}
      {dialog && <Dialog key={dialog.title} request={dialog} />}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Fechar aviso"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
