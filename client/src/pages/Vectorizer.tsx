import { useEffect, useState } from 'react';
import { Download, FileUp, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Card, Chip, EmptyState, Notice, Spinner } from '../components/ui';
import { VECTOR_UPLOAD_MB, type VectorRecord } from '../../../shared/vectorize';

const fileUrl = (v: VectorRecord, file: 'result.pdf' | 'result.svg' | 'preview.png' | 'thumb.jpg' | 'source.png', download = false) =>
  `/api/vectors/${v.id}/${file}${download ? '?download=1' : ''}`;
const inches = (v: number) => `${+v.toFixed(2)}″`;
const LINK_BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-[3px] px-4 font-display text-[15px] font-semibold tracking-wide transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.985]';

function ImageBox({ title, src, href, caption }: { title: string; src: string; href: string; caption: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label">{title}</span>
        <span className="font-mono text-[12px] text-muted">{caption}</span>
      </figcaption>
      <a href={href} target="_blank" rel="noreferrer" title="Open full size in a new tab" className="group relative block aspect-[4/3] overflow-hidden rounded-[2px] border border-line bg-paper shadow-card transition-[border-color,box-shadow] hover:border-navy/40 hover:shadow-card-hover">
        <img src={src} alt={title} className="fade-in absolute inset-0 h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
      </a>
    </figure>
  );
}

export function Vectorizer({ me }: { me: Me }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VectorRecord | null>(null);
  const [recent, setRecent] = useState<VectorRecord[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    api.get<{ vectors: VectorRecord[] }>('/vectors').then((d) => setRecent(d.vectors)).catch(() => setRecent([]));
  }, []);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | undefined) {
    if (!f) return;
    setError('');
    if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|tiff?|gif|avif|bmp|svg|pdf|ai|eps)$/i.test(f.name)) {
      setError('That file is not a picture or PDF. Choose a PNG, JPG, WebP, TIFF, SVG, PDF or .ai file.');
      return;
    }
    setFile(f);
    setPreview(/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(f.type) ? URL.createObjectURL(f) : null);
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const { vector } = await api.upload<{ vector: VectorRecord }>('/vectors', file);
      setResult(vector);
      setRecent((cur) => [vector, ...(cur ?? [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: VectorRecord) {
    if (!window.confirm(`Delete the vector file of "${v.name}"? This cannot be undone.`)) return;
    setDeleting(v.id);
    try {
      await api.del(`/vectors/${v.id}`);
      setRecent((cur) => (cur ?? []).filter((x) => x.id !== v.id));
      if (result?.id === v.id) setResult(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="blueprint min-h-full">
      <TopBar me={me} />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-[340px_minmax(0,1fr)] md:px-6 md:py-10">
        <div className="h-fit min-w-0 md:sticky md:top-[76px]">
        <Card className="rise">
          {busy && <div className="progress" aria-hidden />}
          <div className="space-y-4 p-5 sm:p-6">
            <div>
              <h1 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">Vectorizer</h1>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">Turns a picture or PDF into a clean one-ink vector PDF: outlines only, no pixels, ready for Illustrator.</p>
            </div>

            <label
              className={`block cursor-pointer rounded-[3px] border border-dashed p-4 text-center transition-[background-color,border-color,box-shadow] duration-150 ${dragging ? 'drop-active border-navy bg-navy-50' : 'border-line bg-paper/60 hover:border-navy/50 hover:bg-navy-50/60'}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                choose(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                accept="image/*,.svg,.pdf,.ai,.eps"
                className="sr-only"
                onChange={(e) => {
                  choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {preview ? (
                <img src={preview} alt="Selected picture" className="fade-in mx-auto max-h-40 object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-muted">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-navy-50 text-navy"><FileUp className="h-5 w-5" /></span>
                  <span className="text-[14px] font-medium text-ink">{file ? file.name : 'Drop a picture or PDF here, or click to choose'}</span>
                  <span className="text-[12px]">PNG, JPG, WebP, TIFF, SVG, PDF or .ai, up to {VECTOR_UPLOAD_MB} MB</span>
                </div>
              )}
            </label>
            {file && preview && <div className="break-all text-[13px] text-muted">{file.name}</div>}


            {error && <Notice tone="error">{error}</Notice>}
            <Button className="w-full" onClick={run} busy={busy} disabled={!file}>
              Make vector PDF
            </Button>
            {busy && <p className="fade-in text-[12.5px] text-muted">Tracing. This takes a few seconds.</p>}
          </div>
        </Card>
        </div>

        <section className="min-w-0 space-y-8">
          {result ? (
            <Card rule={false} className="rise">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.08em]">{result.name}</h2>
                  <p className="text-[13px] text-muted">
                    <span className="font-mono">{inches(result.output.widthIn)} × {inches(result.output.heightIn)}</span> · {result.output.shapes} shape{result.output.shapes === 1 ? '' : 's'} · {result.inkPct}% ink · {(result.ms / 1000).toFixed(1)} s
                  </p>
                </div>
                <Chip tone={result.fromPlate ? 'amber' : 'ok'} title={result.fromPlate ? 'The artwork was read from the marks on a plate or card in the picture' : 'The artwork was read from the whole picture'}>
                  {result.fromPlate ? 'Read from a plate' : 'One ink'}
                </Chip>
              </div>
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ImageBox title="Original" src={fileUrl(result, 'source.png')} href={fileUrl(result, 'source.png')} caption={`${result.source.width} × ${result.source.height} px`} />
                  <ImageBox title="Vector" src={fileUrl(result, 'preview.png')} href={fileUrl(result, 'result.pdf')} caption="outlines only" />
                </div>
                {result.fromPlate && <Notice tone="warn">The picture shows the artwork on a plate or card, so the marks on it were traced. Check the result against the original artwork.</Notice>}
                <div className="flex flex-wrap gap-2">
                  <a href={fileUrl(result, 'result.pdf', true)} className={`${LINK_BUTTON} btn-primary bg-navy text-white hover:bg-navy-700`}>
                    <Download className="h-4 w-4" /> Download vector PDF
                  </a>
                  <a href={fileUrl(result, 'result.svg', true)} className={`${LINK_BUTTON} btn-secondary border border-line bg-white text-ink hover:border-navy/50 hover:text-navy`}>
                    <Download className="h-4 w-4" /> SVG
                  </a>
                </div>
                <p className="text-[12.5px] leading-relaxed text-muted">The PDF holds outlines in one ink (#231F20) and nothing else: no pixels, no fonts. Open it in Illustrator to edit the paths. Click a picture to open it full size.</p>
              </div>
            </Card>
          ) : (
            <Card rule={false} className="rise min-h-48">
              <EmptyState icon={<FileUp className="h-5 w-5" />} title="Original and vector, side by side">
                Choose a picture or PDF on the left. You will see the original next to the traced outlines, ready to download as PDF or SVG.
              </EmptyState>
            </Card>
          )}

          <div>
            <h2 className="rise mb-3 font-display text-lg font-semibold uppercase tracking-[0.08em]">Your recent vector files</h2>
            <Card rule={false} className="rise overflow-hidden" >
              {!recent && (
                <div className="flex items-center gap-2 p-5 text-muted">
                  <Spinner /> Loading
                </div>
              )}
              {recent && !recent.length && <EmptyState title="No vector files yet">Finished vector files are kept here for your sign-in.</EmptyState>}
              <ul className="stagger divide-y divide-line">
                {(recent ?? []).map((v) => (
                  <li key={v.id} className={`row-hover flex items-center hover:bg-navy-50/50 ${result?.id === v.id ? 'is-on bg-navy-50/60' : ''}`}>
                    <button type="button" onClick={() => setResult(v)} className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4 pr-2 text-left">
                      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[2px] border border-line bg-paper">
                        <img src={fileUrl(v, 'thumb.jpg')} alt="" className="h-full w-full object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{v.name}</div>
                        <div className="text-[13px] text-muted">
                          <span className="font-mono">{inches(v.output.widthIn)} × {inches(v.output.heightIn)}</span> · {v.createdBy} · {new Date(v.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(v)}
                      disabled={deleting === v.id}
                      className="mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-[3px] text-muted transition-colors hover:bg-white hover:text-signal hover:shadow-card disabled:opacity-50"
                      title="Delete vector file"
                      aria-label={`Delete vector file of ${v.name}`}
                    >
                      {deleting === v.id ? <Spinner /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
