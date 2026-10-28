import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type Cover, imageURL } from "../covers";
type CoverInfo = {
  cover: Cover | null;
  revision: string;
  images: (Cover & { name: string })[];
};
type Props = {
  rom: string;
  generation: string;
  revision: number;
  onChanged: () => void;
};
async function result(response: Response) {
  const data = await response
    .json()
    .catch(() => ({ detail: "Resposta inválida do servidor." }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      String(data.detail).includes("código de acesso")
    )
      window.dispatchEvent(new Event("romdock-auth-expired"));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Não foi possível atualizar a capa.",
    );
  }
  return data;
}
export default function CoverManager({
  rom,
  generation,
  revision,
  onChanged,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [info, setInfo] = useState<CoverInfo | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [editor, setEditor] = useState(false),
    [remove, setRemove] = useState(false),
    [tab, setTab] = useState<"upload" | "existing">("upload"),
    [file, setFile] = useState<globalThis.File | null>(null),
    [choice, setChoice] = useState(""),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(24),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(
    () => setImageFailed(false),
    [rom, info?.cover?.image, info?.cover?.version],
  );
  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      const data = await result(
        await fetch("/api/cover?" + new URLSearchParams({ rom, generation }), {
          signal,
        }),
      );
      if (signal?.aborted) return;
      if (!data.revision || !Array.isArray(data.images))
        throw new Error("Não foi possível consultar as capas.");
      setInfo(data);
      setError("");
    } catch (e) {
      if (!signal?.aborted) {
        setError((e as Error).message);
        setInfo(null);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [rom, generation, revision]);
  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
    if (!editor && dialog.current?.open) dialog.current.close();
  }, [editor]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function open(removal = false) {
    setRemove(removal);
    setFile(null);
    setChoice("");
    setTab("upload");
    setQuery("");
    setLimit(24);
    setError("");
    setEditor(true);
  }
  function selectFile(selected: globalThis.File | null) {
    if (!selected) return;
    if (selected.size > 8 * 1024 * 1024) {
      setError("A imagem deve ter até 8 MB.");
      return;
    }
    setFile(selected);
    setTab("upload");
    setError("");
  }
  async function save() {
    if (!info) return;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await result(
          await fetch("/api/cover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rom,
              generation,
              revision: info.revision,
              remove: true,
            }),
          }),
        );
      } else if (tab === "upload" && file) {
        await result(
          await fetch(
            "/api/cover?" +
              new URLSearchParams({ rom, generation, revision: info.revision }),
            {
              method: "PUT",
              headers: {
                "Content-Type": file.type || "application/octet-stream",
              },
              body: file,
            },
          ),
        );
      } else if (tab === "existing" && choice) {
        await result(
          await fetch("/api/cover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rom,
              generation,
              revision: info.revision,
              image_path: choice,
            }),
          }),
        );
      } else return;
      setEditor(false);
      setFile(null);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const matches = (info?.images || []).filter((image) =>
    image.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="cover-manager">
      <div className="cover-widget-heading">
        <span>CAPA</span>
        {loading && <LoaderCircle size={13} className="spin" />}
      </div>
      {info?.cover && !imageFailed ? (
        <div className="cover-preview">
          <img
            src={imageURL(info.cover, generation)}
            alt={"Capa de " + rom.split("/").at(-1)}
            onError={(event) => {
              setImageFailed(true);
            }}
          />
        </div>
      ) : (
        <div className="cover-placeholder">
          <ImageIcon size={26} />
          <span>
            {loading
              ? "A consultar…"
              : imageFailed
                ? "Imagem indisponível"
                : "Sem capa associada"}
          </span>
        </div>
      )}
      {error && !editor && (
        <p className="cover-error" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>
            <RefreshCw size={12} />
            Tentar novamente
          </button>
        </p>
      )}
      <div className="cover-widget-actions">
        <button
          className="info-open"
          disabled={loading || !info}
          onClick={() => open()}
        >
          <ImagePlus size={15} />
          {info?.cover ? "Alterar capa" : "Adicionar capa"}
        </button>
        {info?.cover && (
          <button
            className="icon-button"
            aria-label="Remover capa"
            title="Remover associação da capa"
            onClick={() => open(true)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <dialog
        ref={dialog}
        className="cover-dialog"
        aria-label={remove ? "Remover capa" : "Gerir capa"}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setEditor(false);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <header>
            <div>
              <h2>{remove ? "Remover capa" : "Gerir capa"}</h2>
              <p>{rom.split("/").at(-1)}</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar gestão de capa"
              disabled={busy}
              onClick={() => setEditor(false)}
            >
              <X size={19} />
            </button>
          </header>
          {remove ? (
            <div className="cover-dialog-content">
              <p className="cover-explanation">
                A associação no gamelist será removida. Os ficheiros das imagens
                são preservados.
              </p>
            </div>
          ) : (
            <div className="cover-dialog-content">
              <div className="cover-tabs">
                <button
                  type="button"
                  className={tab === "upload" ? "active" : ""}
                  onClick={() => setTab("upload")}
                >
                  Enviar imagem
                </button>
                <button
                  type="button"
                  className={tab === "existing" ? "active" : ""}
                  onClick={() => setTab("existing")}
                >
                  Imagens na consola <span>{info?.images.length || 0}</span>
                </button>
              </div>
              {tab === "upload" ? (
                <>
                  <input
                    className="visually-hidden"
                    type="file"
                    ref={input}
                    aria-label="Selecionar imagem para capa"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      selectFile(event.target.files?.[0] || null)
                    }
                  />
                  <button
                    type="button"
                    className="cover-upload-area"
                    onClick={() => input.current?.click()}
                  >
                    {preview ? (
                      <img src={preview} alt="Pré-visualização da nova capa" />
                    ) : (
                      <Upload size={29} />
                    )}
                    <strong>{file?.name || "Selecionar imagem"}</strong>
                    <span>PNG, JPEG ou WebP · até 8 MB</span>
                  </button>
                </>
              ) : (
                <>
                  <label className="file-search cover-image-search">
                    <Search size={16} />
                    <input
                      placeholder="Pesquisar imagens…"
                      aria-label="Pesquisar imagens da consola"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setLimit(24);
                      }}
                    />
                  </label>
                  <div className="cover-image-picker">
                    {matches.slice(0, limit).map((image) => (
                      <button
                        key={image.image}
                        type="button"
                        className={choice === image.image ? "selected" : ""}
                        aria-label={"Usar " + image.name}
                        aria-pressed={choice === image.image}
                        onClick={() => setChoice(image.image)}
                      >
                        <img
                          src={imageURL(image, generation)}
                          alt=""
                          loading="lazy"
                        />
                        <span>{image.name}</span>
                      </button>
                    ))}
                  </div>
                  {!matches.length && (
                    <p className="cover-explanation">
                      Nenhuma imagem disponível nesta pasta.
                    </p>
                  )}
                  {matches.length > limit && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setLimit((n) => n + 24)}
                    >
                      Mostrar mais imagens
                    </button>
                  )}
                </>
              )}
              <p className="cover-explanation">
                A capa é associada ao ficheiro selecionado no gamelist da
                consola. É criada uma cópia de segurança antes da alteração.
              </p>
            </div>
          )}
          {error && editor && (
            <div className="inline-error" role="alert">
              {error}
              <button
                type="button"
                className="icon-button"
                title="Atualizar dados da capa"
                onClick={() => void load()}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          )}
          <footer>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setEditor(false)}
            >
              Cancelar
            </button>
            <button
              className={"button " + (remove ? "danger" : "primary")}
              disabled={
                busy ||
                !info ||
                (!remove && !(tab === "upload" ? file : choice))
              }
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : null}
              {busy
                ? "A guardar…"
                : remove
                  ? "Remover associação"
                  : "Guardar capa"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
