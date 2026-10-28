import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, File, LoaderCircle, X } from "lucide-react";
import { bytes, date, type Entry } from "../library";
export type PreviewTarget = { path: string; generation: string; entry: Entry };
type Metadata = {
  name: string;
  size: number;
  modified: number;
  kind: "image" | "video" | "audio" | "text" | "binary" | "pdf";
  text?: string;
  truncated?: boolean;
};
export default function FilePreview({
  target,
  onClose,
  onDownload,
}: {
  target: PreviewTarget;
  onClose: () => void;
  onDownload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<Metadata | null>(null),
    [error, setError] = useState(""),
    [mediaError, setMediaError] = useState(false);
  const query = new URLSearchParams({
    path: target.path,
    generation: target.generation,
  }).toString();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    setInfo(null);
    setError("");
    setMediaError(false);
    const abort = new AbortController();
    fetch("/api/preview?" + query, { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Não foi possível abrir a pré-visualização.",
          );
        if (!data.kind)
          throw new Error("Não foi possível identificar a pré-visualização.");
        if (!abort.signal.aborted) setInfo(data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [query]);
  const media = "/api/media?" + query;
  return (
    <dialog
      className="file-preview-dialog"
      ref={dialog}
      aria-label="Pré-visualização"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2>{target.entry.name}</h2>
          <span>
            {bytes(info?.size ?? target.entry.size)} ·{" "}
            {date(info?.modified ?? target.entry.modified)}
          </span>
        </div>
        <div>
          <button className="button secondary" onClick={onDownload}>
            <ArrowDownToLine size={15} />
            <span>Descarregar</span>
          </button>
          <button
            className="icon-button"
            aria-label="Fechar pré-visualização"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div className={"file-preview-content " + (info?.kind || "loading")}>
        {error ? (
          <div className="preview-message" role="alert">
            <File size={35} />
            <strong>{error}</strong>
            <span>O ficheiro original pode ser descarregado.</span>
          </div>
        ) : !info ? (
          <div className="preview-message">
            <LoaderCircle size={29} className="spin" />
            <span>A preparar pré-visualização…</span>
          </div>
        ) : mediaError ? (
          <div className="preview-message" role="alert">
            <File size={35} />
            <strong>O navegador não conseguiu apresentar este formato.</strong>
            <span>
              Utilizar Descarregar para abrir o ficheiro noutra aplicação.
            </span>
          </div>
        ) : info.kind === "image" ? (
          <img
            src={"/api/preview-image?" + query}
            alt={info.name}
            onError={() => setMediaError(true)}
          />
        ) : info.kind === "video" ? (
          <video
            src={media}
            controls
            playsInline
            preload="metadata"
            aria-label={"Vídeo " + info.name}
            onError={() => setMediaError(true)}
          />
        ) : info.kind === "audio" ? (
          <div className="audio-preview">
            <File size={57} />
            <strong>{info.name}</strong>
            <audio
              src={media}
              controls
              preload="metadata"
              aria-label={"Áudio " + info.name}
              onError={() => setMediaError(true)}
            />
          </div>
        ) : info.kind === "pdf" ? (
          <iframe src={media} title={"PDF " + info.name} />
        ) : (
          <>
            <div className="preview-format-note">
              {info.kind === "binary"
                ? "Ficheiro binário · primeiros 512 bytes"
                : "Texto · leitura apenas"}
              {info.truncated && " · conteúdo parcial"}
            </div>
            <pre tabIndex={0}>{info.text || "Ficheiro vazio."}</pre>
          </>
        )}
      </div>
      <footer>
        <span title={target.path}>/storage/roms/{target.path}</span>
        <span>Pré-visualização · o original não é alterado</span>
      </footer>
    </dialog>
  );
}
