import CoverManager from "./CoverManager";
import RefreshGamelistNote from "./RefreshGamelistNote";
import { coverEligible } from "../covers";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  PanelRightOpen,
  PanelRightClose,
  File,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Upload,
  X,
} from "lucide-react";
import { type Entry, bytes, date, systemName } from "../library";
export type FolderInfo = {
  files: number;
  folders: number;
  bytes: number;
  modified: number;
};
type Status = {
  connected: boolean;
  host?: string;
  port?: number;
  username?: string;
  generation?: string;
  storage?: { total: number; used: number; free: number };
};
type Transfer = { id: string; name: string; state: string; progress: number };
type Props = {
  collapsed: boolean;
  onToggle: () => void;
  onChanged: () => void;
  status: Status;
  path: string;
  entries: Entry[];
  selection: Entry | null;
  revision: number;
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onDownload: (entry: Entry) => void;
  transfers: Transfer[];
  onTransfers: () => void;
};
export default function LibraryInfo({
  collapsed,
  onToggle,
  status,
  onChanged,
  path,
  entries,
  selection,
  revision,
  open,
  onClose,
  onNavigate,
  onDownload,
  transfers,
  onTransfers,
}: Props) {
  const [wide, setWide] = useState(
    () => matchMedia("(min-width:1001px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(min-width:1001px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [info, setInfo] = useState<FolderInfo | null>(null),
    [busy, setBusy] = useState(false);
  const selectedPath = selection
    ? [path, selection.name].filter(Boolean).join("/")
    : path;
  const directory = selection ? selection.directory : true;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let valid = true;
    setInfo(null);
    setBusy(false);
    if (!status.connected || !directory) return;
    if (!selection) {
      setInfo({
        files: entries.filter((e) => !e.directory && !e.symlink).length,
        folders: entries.filter((e) => e.directory && !e.symlink).length,
        bytes: entries
          .filter((e) => !e.directory && !e.symlink)
          .reduce((n, e) => n + e.size, 0),
        modified: 0,
      });
      return;
    }
    if (!wide && !open) return;
    setBusy(true);
    fetch(
      "/api/folder-info?" +
        new URLSearchParams({
          path: selectedPath,
          generation: status.generation || "",
        }),
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (valid)
          setInfo(data && typeof data.files === "number" ? data : null);
      })
      .catch(() => {})
      .finally(() => {
        if (valid) setBusy(false);
      });
    return () => {
      valid = false;
    };
  }, [
    status.connected,
    status.generation,
    selectedPath,
    directory,
    entries,
    revision,
    selection,
    wide,
    open,
  ]);
  useEffect(() => {
    const media = matchMedia("(max-width:1000px)");
    const sync = () => {
      if (open && media.matches && !dialog.current?.open)
        dialog.current?.showModal();
      else if ((!open || !media.matches) && dialog.current?.open)
        dialog.current.close();
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [open]);
  const active = transfers.find((t) => t.state === "uploading"),
    waiting = transfers.filter((t) => t.state === "queued").length;
  const used = status.storage
    ? (status.storage.used / status.storage.total) * 100
    : 0;
  const content = (
    <>
      <header className="info-panel-heading">
        <span>Informação</span>
        <button
          className="icon-button"
          aria-label={
            wide ? "Encolher painel de informação" : "Fechar informação"
          }
          onClick={wide ? onToggle : onClose}
        >
          {wide ? <PanelRightClose size={18} /> : <X size={18} />}
        </button>
      </header>
      <section>
        <div className="info-eyebrow">CONSOLA</div>
        <div className="info-device">
          <Gamepad2 size={23} />
          <div>
            <strong>Consola ROCKNIX</strong>
            <span>
              <i className="online-dot" />
              {status.connected ? "Ligação estabelecida" : "Sem ligação"}
            </span>
          </div>
        </div>
        <dl>
          <dt>Endereço IP</dt>
          <dd>{status.host || "—"}</dd>
          <dt>Protocolo</dt>
          <dd>SFTP · porta {status.port || 22}</dd>
          <dt>Utilizador</dt>
          <dd>{status.username || "root"}</dd>
        </dl>
      </section>
      <section>
        <div className="info-eyebrow">
          ARMAZENAMENTO
          <HardDrive size={13} />
        </div>
        <div className="info-free">
          <strong>{status.storage ? bytes(status.storage.free) : "—"}</strong>
          <span>disponíveis</span>
        </div>
        <div className="info-storage-track">
          <i style={{ width: `${used}%` }} />
        </div>
        <div className="info-storage-legend">
          <span>
            {status.storage
              ? bytes(status.storage.used) + " utilizados"
              : "Não consultado"}
          </span>
          <span>
            {status.storage ? bytes(status.storage.total) + " total" : ""}
          </span>
        </div>
      </section>
      <section>
        <div className="info-eyebrow">
          {selection ? "SELEÇÃO ATUAL" : "LOCALIZAÇÃO ATUAL"}
          {directory ? <FolderOpen size={13} /> : <File size={13} />}
        </div>
        <h2>
          {selection
            ? systemName(selection.name)
            : path
              ? systemName(path.split("/").at(-1)!)
              : "Pasta ROMs"}
        </h2>
        <div
          className="info-path"
          title={"/storage/roms" + (selectedPath ? "/" + selectedPath : "")}
        >
          /storage/roms{selectedPath ? "/" + selectedPath : ""}
        </div>
        {directory ? (
          <>
            <dl>
              <dt>
                {!selectedPath ? "Sistemas e pastas" : "Ficheiros diretos"}
              </dt>
              <dd>
                {busy
                  ? "A consultar…"
                  : info
                    ? !selectedPath
                      ? info.folders
                      : info.files
                    : "Indisponível"}
              </dd>
              {selectedPath && (
                <>
                  <dt>Subpastas</dt>
                  <dd>{info?.folders ?? "—"}</dd>
                  <dt>Volume direto</dt>
                  <dd>{info ? bytes(info.bytes) : "—"}</dd>
                </>
              )}
            </dl>
            {selectedPath && (
              <p className="info-note">
                Contagens e volume desta pasta, sem incluir o conteúdo das
                subpastas.
              </p>
            )}
            {selection && (
              <button
                className="info-open"
                onClick={() => onNavigate(selectedPath)}
              >
                Abrir pasta
                <ArrowRight size={15} />
              </button>
            )}
          </>
        ) : (
          <>
            <dl>
              <dt>Tamanho</dt>
              <dd>{bytes(selection!.size)}</dd>
              <dt>Formato</dt>
              <dd>{selection!.name.split(".").at(-1)?.toUpperCase()}</dd>
              <dt>Modificado</dt>
              <dd>{date(selection!.modified)}</dd>
            </dl>
            <button
              className="info-open"
              onClick={() => onDownload(selection!)}
            >
              Descarregar ficheiro
              <ArrowRight size={15} />
            </button>
          </>
        )}
      </section>
      {selection &&
        !selection.directory &&
        !selection.symlink &&
        coverEligible(selection.name) && (
          <section>
            <CoverManager
              rom={selectedPath}
              generation={status.generation || ""}
              revision={revision}
              onChanged={onChanged}
            />
          </section>
        )}
      <section>
        <div className="info-eyebrow">
          TRANSFERÊNCIAS
          <button onClick={onTransfers}>
            Ver fila
            <ArrowRight size={12} />
          </button>
        </div>
        {active ? (
          <>
            <div className="info-active-transfer">
              <Upload size={19} />
              <div>
                <strong>{active.name}</strong>
                <span>
                  {active.progress >= 99
                    ? "A guardar na consola…"
                    : active.progress + "% transferido"}
                </span>
              </div>
            </div>
            <div className="info-storage-track transfer-track">
              <i style={{ width: `${active.progress}%` }} />
            </div>
          </>
        ) : (
          <p className="info-empty-transfer">
            {transfers.length
              ? `${transfers.filter((t) => t.state === "done").length} concluídas · ${transfers.filter((t) => t.state === "error").length} com erro`
              : "Sem transferências nesta sessão."}
          </p>
        )}
        {transfers.some((transfer) => transfer.state === "done") && (
          <RefreshGamelistNote />
        )}
        {waiting > 0 && (
          <p className="info-note">{waiting} ficheiros em espera</p>
        )}
      </section>
    </>
  );
  return (
    <>
      <aside className="library-info" aria-label="Informação da biblioteca">
        {wide ? (
          collapsed ? (
            <button
              className="icon-button expand-info-rail"
              aria-label="Expandir painel de informação"
              title="Expandir informação"
              onClick={onToggle}
            >
              <PanelRightOpen size={19} />
            </button>
          ) : (
            content
          )
        ) : null}
      </aside>
      <dialog
        ref={dialog}
        className="library-info-dialog"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <aside
          className="library-info mobile-info"
          aria-label="Informação da biblioteca"
        >
          {!wide ? content : null}
        </aside>
      </dialog>
    </>
  );
}
