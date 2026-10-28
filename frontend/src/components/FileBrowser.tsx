import SystemIcon, { hasSystemIcon } from "./SystemIcon";
import { type Cover, coverEligible, imageURL } from "../covers";
import { Image as ImageIcon } from "lucide-react";
import { useEffect, useState, useRef, type CSSProperties } from "react";
import {
  ArrowDownToLine,
  Eye,
  ArrowUp,
  ArrowDown,
  Ellipsis,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Disc3,
  CircleHelp,
  File,
  Folder,
  FolderOpen,
  Gamepad2,
  LayoutGrid,
  List,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type Entry, systems, systemName, bytes, date, join } from "../library";

type Props = {
  onPreview: (entry: Entry) => void;
  generation: string;
  revision: number;
  onInspect: (entry: Entry) => void;
  path: string;
  entries: Entry[];
  loading: boolean;
  loadError: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onDownload: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
};
function storedView(): "grid" | "list" {
  try {
    return localStorage.getItem("romdock-view") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
export default function FileBrowser({
  path,
  generation,
  revision,
  onInspect,
  onPreview,
  entries,
  loading,
  loadError,
  onNavigate,
  onRefresh,
  onDownload,
  onRename,
  onDelete,
}: Props) {
  const [covers, setCovers] = useState<Record<string, Cover>>({}),
    [showCovers, setShowCovers] = useState(() => {
      try {
        return localStorage.getItem("romdock-show-covers") !== "false";
      } catch {
        return true;
      }
    });
  useEffect(() => {
    setCovers({});
    if (!path || !showCovers) return;
    const abort = new AbortController();
    fetch("/api/covers?" + new URLSearchParams({ path, generation }), {
      signal: abort.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!abort.signal.aborted) setCovers(data?.covers || {});
      })
      .catch(() => {});
    return () => abort.abort();
  }, [path, generation, revision, showCovers]);
  const [context, setContext] = useState<{
    entry: Entry;
    x: number;
    y: number;
  } | null>(null);
  const storedSort = () => {
    try {
      const value = JSON.parse(localStorage.getItem("romdock-sort") || "null");
      if (
        value &&
        ["name", "size", "modified"].includes(value.field) &&
        ["asc", "desc"].includes(value.direction)
      )
        return value;
    } catch {}
    return { field: "name", direction: "asc" };
  };
  const storedGridSize = () => {
    try {
      const raw = localStorage.getItem("romdock-grid-size");
      if (raw !== null) {
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 104 && value <= 208)
          return Math.round((value - 104) / 8) * 8 + 104;
      }
    } catch {}
    return 144;
  };
  const [gridSize, setGridSize] = useState(storedGridSize);
  function resizeGrid(value: number) {
    setGridSize(value);
    try {
      localStorage.setItem("romdock-grid-size", String(value));
    } catch {}
  }
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState<string>(() => storedSort().field),
    [direction, setDirection] = useState<string>(() => storedSort().direction),
    [view, setView] = useState<"grid" | "list">(storedView),
    [visibleCount, setVisibleCount] = useState(120);
  const sentinel = useRef<HTMLDivElement>(null),
    menuRef = useRef<HTMLDivElement>(null),
    triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setVisibleCount(120);
  }, [search, filter, sort, direction]);
  function chooseSort(field: string) {
    const next =
      field === sort
        ? direction === "asc"
          ? "desc"
          : "asc"
        : field === "name"
          ? "asc"
          : "desc";
    setSort(field);
    setDirection(next);
    try {
      localStorage.setItem(
        "romdock-sort",
        JSON.stringify({ field, direction: next }),
      );
    } catch {}
  }
  function openContext(
    entry: Entry,
    x: number,
    y: number,
    trigger: HTMLElement,
  ) {
    triggerRef.current = trigger;
    setContext({
      entry,
      x: Math.max(8, Math.min(x, innerWidth - 210)),
      y: Math.max(8, Math.min(y, innerHeight - 230)),
    });
  }
  function closeContext(restore = false) {
    setContext(null);
    if (restore) triggerRef.current?.focus();
  }
  useEffect(() => {
    if (context)
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus();
  }, [context]);
  useEffect(() => {
    if (!context) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".context-menu")) setContext(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeContext(true);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [context]);
  const visible = entries
    .filter((entry) => {
      const name =
        entry.directory && !path
          ? systemName(entry.name) + " " + entry.name
          : entry.name;
      return (
        name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (filter === "all" ||
          (filter === "folders" ? entry.directory : !entry.directory))
      );
    })
    .sort((a, b) => {
      const factor = direction === "asc" ? 1 : -1;
      if (sort === "modified")
        return (
          factor * (a.modified - b.modified) || a.name.localeCompare(b.name)
        );
      if (sort === "size")
        return factor * (a.size - b.size) || a.name.localeCompare(b.name);
      if (a.directory !== b.directory) return a.directory ? -1 : 1;
      const name = (entry: Entry) =>
        !path && entry.directory ? systemName(entry.name) : entry.name;
      return factor * name(a).localeCompare(name(b), "pt", { numeric: true });
    });
  const slice = visible.slice(0, visibleCount),
    hasMore = slice.length < visible.length;
  useEffect(() => {
    if (!hasMore || !sentinel.current || !("IntersectionObserver" in window))
      return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting))
          setVisibleCount((count) => Math.min(count + 120, visible.length));
      },
      { root: sentinel.current.closest(".finder-main"), rootMargin: "500px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, visible.length]);
  function switchView(next: "grid" | "list") {
    setView(next);
    try {
      localStorage.setItem("romdock-view", next);
    } catch {
      /* Storage may be disabled in private browsers. */
    }
  }
  return (
    <>
      <section className="file-panel" aria-label="Explorador de ficheiros">
        <div className="browser-sticky-controls">
          <div className="file-toolbar">
            <div className="breadcrumbs">
              <button
                aria-label="Todos os sistemas"
                onClick={() => onNavigate("")}
              >
                <FolderOpen size={17} />
                <span>roms</span>
              </button>
              {path
                .split("/")
                .filter(Boolean)
                .map((part, index) => (
                  <span className="crumb" key={index}>
                    <ChevronRight size={13} />
                    <button
                      onClick={() =>
                        onNavigate(
                          path
                            .split("/")
                            .slice(0, index + 1)
                            .join("/"),
                        )
                      }
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </div>
            <div className="browser-toolbar-actions">
              <button
                className={`icon-button covers-toggle ${showCovers ? "active" : ""}`}
                aria-label="Mostrar capas"
                aria-pressed={showCovers}
                title={showCovers ? "Ocultar capas" : "Mostrar capas"}
                onClick={() => {
                  setShowCovers((value) => {
                    try {
                      localStorage.setItem(
                        "romdock-show-covers",
                        String(!value),
                      );
                    } catch {}
                    return !value;
                  });
                }}
              >
                <ImageIcon size={16} />
              </button>
              {view === "grid" && (
                <label className="grid-size-control" title="Tamanho dos ícones">
                  <LayoutGrid size={12} aria-hidden="true" />
                  <input
                    type="range"
                    min="104"
                    max="208"
                    step="8"
                    value={gridSize}
                    aria-label="Tamanho dos ícones"
                    onChange={(event) => resizeGrid(Number(event.target.value))}
                  />
                  <LayoutGrid size={18} aria-hidden="true" />
                </label>
              )}
              <div className="view-toggle" aria-label="Apresentação">
                <button
                  className={view === "grid" ? "active" : ""}
                  aria-pressed={view === "grid"}
                  aria-label="Vista em grelha"
                  onClick={() => switchView("grid")}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  className={view === "list" ? "active" : ""}
                  aria-pressed={view === "list"}
                  aria-label="Vista em lista"
                  onClick={() => switchView("list")}
                >
                  <List size={17} />
                </button>
              </div>
              <button
                className="icon-button"
                aria-label="Atualizar pasta"
                title="Atualizar pasta"
                onClick={onRefresh}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />
              </button>
            </div>
          </div>
          <div className="file-controls">
            <div className="file-search">
              <Search size={18} />
              <input
                placeholder="Pesquisar nesta pasta…"
                aria-label="Pesquisar nesta pasta"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Limpar pesquisa"
                  onClick={() => setSearch("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="browser-filter-controls">
              <div className="filter-tabs" aria-label="Tipo de conteúdo">
                <button
                  aria-pressed={filter === "all"}
                  className={filter === "all" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  Tudo
                </button>
                <button
                  aria-pressed={filter === "folders"}
                  className={filter === "folders" ? "active" : ""}
                  onClick={() => setFilter("folders")}
                >
                  Pastas
                </button>
                <button
                  aria-pressed={filter === "files"}
                  className={filter === "files" ? "active" : ""}
                  onClick={() => setFilter("files")}
                >
                  Ficheiros
                </button>
              </div>
              <div
                className="sort-fields"
                role="group"
                aria-label="Ordenar ficheiros"
              >
                {[
                  ["name", "Nome"],
                  ["size", "Tamanho"],
                  ["modified", "Modificado"],
                ].map(([field, label]) => (
                  <button
                    key={field}
                    aria-label={label}
                    aria-pressed={sort === field}
                    className={sort === field ? "active" : ""}
                    onClick={() => chooseSort(field)}
                    title={
                      sort === field
                        ? direction === "asc"
                          ? "Ordem crescente; inverter"
                          : "Ordem decrescente; inverter"
                        : "Ordenar por " + label.toLowerCase()
                    }
                  >
                    {label}
                    {sort === field &&
                      (direction === "asc" ? (
                        <ArrowUp size={12} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={12} aria-hidden="true" />
                      ))}
                  </button>
                ))}
              </div>
              <span className="visually-hidden" role="status">
                Ordenação:{" "}
                {sort === "name"
                  ? "nome"
                  : sort === "size"
                    ? "tamanho"
                    : "modificação"}
                , ordem {direction === "asc" ? "crescente" : "decrescente"}.
              </span>
            </div>
          </div>
        </div>
        {path && (
          <button
            className="parent-folder"
            onClick={() => onNavigate(path.split("/").slice(0, -1).join("/"))}
          >
            <ArrowLeft size={16} />
            Voltar à pasta anterior
          </button>
        )}
        {loading ? (
          <div className="table-empty" role="status">
            <LoaderCircle className="spin" size={25} />
            <strong>A carregar ficheiros…</strong>
            <span>A consultar a consola.</span>
          </div>
        ) : slice.length ? (
          <div
            className={`entries-view ${view === "list" ? "list-view" : "grid-view"}`}
            style={
              {
                "--grid-size": gridSize + "px",
                "--icon-size": Math.round(gridSize * 0.44) + "px",
                "--icon-width": Math.round(gridSize * 0.53) + "px",
                "--file-icon-size": Math.round(gridSize * 0.36) + "px",
              } as CSSProperties
            }
            role="list"
            aria-label="Ficheiros e pastas"
          >
            {slice.map((entry) => {
              const sys = !path ? systems[entry.name] : undefined;
              const label =
                !path && entry.directory ? systemName(entry.name) : entry.name;
              const icon = entry.directory ? (
                <Folder size={58} />
              ) : (
                <File size={48} />
              );
              const kind = entry.symlink
                ? "Acesso bloqueado"
                : entry.directory
                  ? !path
                    ? "Sistema"
                    : "Pasta"
                  : entry.name.includes(".")
                    ? entry.name.split(".").pop()!.toUpperCase()
                    : "Ficheiro";
              const body = (
                <>
                  <div className="card-top">
                    <span
                      className={`card-icon ${entry.directory ? "folder" : ""} ${!entry.directory && showCovers && covers[entry.name] ? "with-cover" : ""}`}
                      style={
                        sys
                          ? { color: sys[2], background: sys[2] + "12" }
                          : undefined
                      }
                    >
                      {icon}
                      {!path &&
                        entry.directory &&
                        hasSystemIcon(entry.name) && (
                          <span className="folder-system-badge">
                            <SystemIcon system={entry.name} />
                          </span>
                        )}
                      {!entry.directory && showCovers && covers[entry.name] && (
                        <img
                          className="rom-cover"
                          src={imageURL(covers[entry.name], generation)}
                          alt={"Capa de " + entry.name}
                          loading="lazy"
                          onError={(event) =>
                            event.currentTarget.classList.add("image-failed")
                          }
                        />
                      )}
                    </span>
                    <span className="card-kind">{sys?.[1] || kind}</span>
                    {entry.directory && !entry.symlink && (
                      <ArrowRight className="card-open-arrow" size={16} />
                    )}
                  </div>
                  <div className="card-name" title={label}>
                    {label}
                  </div>
                  <div className="card-subtitle">
                    {entry.directory ? "Pasta" : bytes(entry.size)}
                  </div>
                </>
              );
              return (
                <article
                  className={`file-card ${entry.symlink ? "symlink" : ""}`}
                  role="listitem"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!entry.symlink)
                      openContext(
                        entry,
                        event.clientX,
                        event.clientY,
                        event.currentTarget.querySelector<HTMLElement>(
                          ".card-body",
                        ) || event.currentTarget,
                      );
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === " " || event.code === "Space") &&
                      !entry.directory &&
                      !entry.symlink
                    ) {
                      event.preventDefault();
                      onPreview(entry);
                      return;
                    }
                    if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    ) {
                      event.preventDefault();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      openContext(
                        entry,
                        bounds.left + 20,
                        bounds.top + 35,
                        event.currentTarget.querySelector<HTMLElement>(
                          ".card-body",
                        ) || event.currentTarget,
                      );
                    }
                  }}
                  key={entry.name}
                >
                  {entry.directory && !entry.symlink ? (
                    <button
                      className="card-body"
                      aria-label={"Abrir " + label}
                      onClick={() => onNavigate(join(path, entry.name))}
                    >
                      {body}
                    </button>
                  ) : (
                    <button
                      className="card-body"
                      aria-label={"Selecionar " + entry.name}
                      onDoubleClick={() => onPreview(entry)}
                      onClick={() => onInspect(entry)}
                      disabled={entry.symlink}
                    >
                      {body}
                    </button>
                  )}
                  <div className="card-bottom">
                    <span className="card-date">{date(entry.modified)}</span>
                    <div className="row-actions">
                      {!entry.directory && (
                        <button
                          className="icon-button"
                          aria-label={"Pré-visualizar " + entry.name}
                          title="Pré-visualizar (Espaço)"
                          disabled={entry.symlink}
                          onClick={() => onPreview(entry)}
                        >
                          <Eye size={15} />
                        </button>
                      )}
                      <button
                        className="icon-button more-file-actions"
                        aria-label={"Ações de " + entry.name}
                        disabled={entry.symlink}
                        onClick={(event) => {
                          const bounds =
                            event.currentTarget.getBoundingClientRect();
                          openContext(
                            entry,
                            bounds.left,
                            bounds.bottom,
                            event.currentTarget,
                          );
                        }}
                      >
                        <Ellipsis size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={"Informação sobre " + entry.name}
                        title="Informação"
                        disabled={entry.symlink}
                        onClick={() => onInspect(entry)}
                      >
                        <CircleHelp size={16} />
                      </button>
                      {!entry.directory && (
                        <button
                          className="icon-button"
                          aria-label={"Descarregar " + entry.name}
                          title="Descarregar"
                          disabled={entry.symlink}
                          onClick={() => onDownload(entry)}
                        >
                          <ArrowDownToLine size={16} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={"Renomear " + entry.name}
                        title="Renomear"
                        disabled={entry.symlink}
                        onClick={() => onRename(entry)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button delete-button"
                        aria-label={"Eliminar " + entry.name}
                        title="Eliminar"
                        disabled={entry.symlink}
                        onClick={() => onDelete(entry)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="table-empty">
            <FolderOpen size={30} />
            <strong>
              {loadError
                ? "Não foi possível carregar a pasta"
                : search || filter !== "all"
                  ? "Nenhum resultado encontrado"
                  : "Pasta vazia"}
            </strong>
            <span>
              {loadError
                ? "Utilizar o botão de atualização para tentar novamente."
                : search
                  ? "Alterar a pesquisa para consultar outros resultados."
                  : "Transferir ficheiros ou criar uma pasta nesta localização."}
            </span>
          </div>
        )}
        {hasMore && (
          <div ref={sentinel} className="load-more-files">
            <button
              onClick={() =>
                setVisibleCount((count) =>
                  Math.min(count + 120, visible.length),
                )
              }
            >
              Mostrar mais ficheiros
            </button>
            <span>
              {slice.length} de {visible.length} apresentados
            </span>
          </div>
        )}
        <div className="browser-results" role="status">
          {visible.length} {visible.length === 1 ? "item" : "itens"}
          {visible.length !== entries.length ? ` de ${entries.length}` : ""}
        </div>
        <div className="browser-path">
          <ShieldIcon />
          <span>/storage/roms{path ? "/" + path : ""}</span>
        </div>
      </section>
      {context && (
        <div
          className="context-menu"
          role="menu"
          ref={menuRef}
          onKeyDown={(event) => {
            const buttons = Array.from(
              menuRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              ) || [],
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let target = -1;
            if (event.key === "ArrowDown")
              target = (index + 1) % buttons.length;
            if (event.key === "ArrowUp")
              target = (index - 1 + buttons.length) % buttons.length;
            if (event.key === "Home") target = 0;
            if (event.key === "End") target = buttons.length - 1;
            if (target >= 0) {
              event.preventDefault();
              buttons[target]?.focus();
            }
            if (event.key === "Tab") {
              event.preventDefault();
              closeContext(true);
            }
          }}
          aria-label="Ações do ficheiro"
          style={{ left: context.x, top: context.y }}
        >
          {!context.entry.directory && (
            <button
              role="menuitem"
              onClick={() => {
                onPreview(context.entry);
                setContext(null);
              }}
            >
              <Eye size={15} />
              Pré-visualizar
            </button>
          )}
          {context.entry.directory ? (
            <button
              role="menuitem"
              onClick={() => {
                onNavigate(join(path, context.entry.name));
                setContext(null);
              }}
            >
              <FolderOpen size={15} />
              Abrir pasta
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => {
                onDownload(context.entry);
                setContext(null);
              }}
            >
              <ArrowDownToLine size={15} />
              Descarregar
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              onInspect(context.entry);
              setContext(null);
            }}
          >
            <CircleHelp size={15} />
            Informação
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              onRename(context.entry);
              setContext(null);
            }}
          >
            <Pencil size={15} />
            Renomear
          </button>
          <button
            className="destructive"
            role="menuitem"
            onClick={() => {
              onDelete(context.entry);
              setContext(null);
            }}
          >
            <Trash2 size={15} />
            Eliminar
          </button>
        </div>
      )}
    </>
  );
}
function ShieldIcon() {
  return <span className="online-dot" aria-hidden="true" />;
}
