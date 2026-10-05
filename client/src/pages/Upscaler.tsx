import { useEffect, useState } from 'react';
import { Download, ImageUp, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Card, Chip, EmptyState, Notice, Spinner, fmtUsd } from '../components/ui';
import { MIN_SCALE, UPSCALE_TARGETS, targetSize, type UpscaleRecord, type UpscaleTarget } from '../../../shared/upscale';

const fileUrl = (u: UpscaleRecord, file: 'upscaled.png' | 'standard.png' | 'original.png' | 'thumb.jpg', download = false) =>
  `/api/upscales/${u.id}/${file}${download ? '?download=1' : ''}`;
const px = (s: { width: number; height: number }) => `${s.width} × ${s.height} px`;
const LINK_BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-[3px] px-4 font-display text-[15px] font-semibold tracking-wide transition-colors duration-150 ease-out';
const FIDELITY_TONE = { ok: 'ok', amber: 'warn', red: 'error' } as const;

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

export function Upscaler({ me }: { me: Me }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [target, setTarget] = useState<UpscaleTarget>('720p');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<UpscaleRecord | null>(null);
  const [recent, setRecent] = useState<UpscaleRecord[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    api.get<{ upscales: UpscaleRecord[] }>('/upscales').then((d) => setRecent(d.upscales)).catch(() => setRecent([]));
  }, []);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | undefined) {
    if (!f) return;
    setError('');
    setDims(null);
    if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|tiff?|gif|avif|heic)$/i.test(f.name)) {
      setError('That file is not an image. Choose a PNG, JPG, WebP, TIFF or GIF.');
      return;
    }
    const url = URL.createObjectURL(f);
    setFile(f);
    setPreview(url);
    const img = new Image();
    img.onload = () => setDims({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
  }

  const out = dims ? targetSize(dims.width, dims.height, target) : null;
  const alreadyBig = !!out && out.scale < MIN_SCALE;

  async function run() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const { upscale } = await api.upload<{ upscale: UpscaleRecord }>('/upscales', file, { target });
      setResult(upscale);
      setRecent((cur) => [upscale, ...(cur ?? [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: UpscaleRecord) {
    if (!window.confirm(`Delete the upscale of "${u.name}"? This cannot be undone.`)) return;
    setDeleting(u.id);
    try {
      await api.del(`/upscales/${u.id}`);
      setRecent((cur) => (cur ?? []).filter((x) => x.id !== u.id));
      if (result?.id === u.id) setResult(null);
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
              <h1 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">AI Upscaler</h1>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">Enlarges a low-resolution image just enough to be usable, without changing what is in it.</p>
            </div>

            <label
              className={`block cursor-pointer rounded-[3px] border border-dashed p-4 text-center transition-[background-color,border-color,box-shadow] ${dragging ? 'drop-active border-navy bg-navy-50' : 'border-line bg-paper/60 hover:border-navy/50 hover:bg-navy-50/60'}`}
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
                accept="image/png,image/jpeg,image/webp,image/tiff,image/gif,image/avif"
                className="sr-only"
                onChange={(e) => {
                  choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {preview ? (
                <img src={preview} alt="Selected image" className="mx-auto max-h-40 object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-muted">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-navy-50 text-navy"><ImageUp className="h-5 w-5" /></span>
                  <span className="text-[14px] font-medium text-ink">Drop an image here or click to choose</span>
                  <span className="text-[12px]">PNG, JPG, WebP, TIFF or GIF, up to 30 MB</span>
                </div>
              )}
            </label>
            {file && (
              <div className="text-[13px] text-muted">
                <span className="break-all">{file.name}</span>
                {dims && <span className="font-mono"> · {px(dims)}</span>}
              </div>
            )}

            <fieldset>
              <legend className="label">Upscale to</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(Object.keys(UPSCALE_TARGETS) as UpscaleTarget[]).map((t) => (
                  <label key={t} className={`flex h-10 cursor-pointer items-center justify-center rounded-[3px] border font-display text-[14px] font-semibold transition-[background-color,border-color,color,box-shadow] ${target === t ? 'border-navy bg-navy text-white shadow-[0_4px_10px_-6px_rgba(31,38,64,0.6)]' : 'border-line bg-white text-graphite hover:border-navy/50 hover:text-navy'}`}>
                    <input type="radio" name="target" value={t} checked={target === t} onChange={() => setTarget(t)} className="sr-only" />
                    {t}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-muted">The short side becomes {UPSCALE_TARGETS[target]} px. Use the smallest size that works: less enlargement means less for the AI to fill in.</p>
            </fieldset>

            {out && dims && !alreadyBig && (
              <div className="text-[13px]">
                <span className="font-mono">{px(dims)}</span> → <span className="font-mono font-medium text-navy">{px(out)}</span>{' '}
                <span className="text-muted">({out.scale.toFixed(1)}×)</span>
                {out.scale > 4 && <div className="mt-1"><Notice tone="warn">This is a very small image. At more than 4× the AI has to fill in a lot; check the result carefully.</Notice></div>}
              </div>
            )}
            {alreadyBig && dims && <Notice tone="info">This image is already {px(dims)}, at least {target}. It does not need upscaling.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}

            <Button className="w-full" onClick={run} busy={busy} disabled={!file || !dims || alreadyBig}>
              Upscale image
            </Button>
            {busy && <p className="fade-in text-[12.5px] text-muted">Upscaling. This usually takes 30 to 90 seconds; keep this page open.</p>}
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
                    <span className="font-mono">{px(result.original)}</span> → <span className="font-mono">{px(result.output)}</span> ({result.scale}×)
                    {result.costUsd ? ` · ${fmtUsd(result.costUsd)}` : ''} · {Math.round(result.ms / 1000)} s
                  </p>
                </div>
                <Chip tone={result.fidelity.tone === 'ok' ? 'ok' : result.fidelity.tone === 'amber' ? 'amber' : 'red'} title="How closely the upscale matches the original when shrunk back to the original size">
                  {result.fidelity.matchPct}% match
                </Chip>
              </div>
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ImageBox title="Original" src={fileUrl(result, 'original.png')} href={fileUrl(result, 'original.png')} caption={px(result.original)} />
                  <ImageBox title="AI upscaled" src={fileUrl(result, 'upscaled.png')} href={fileUrl(result, 'upscaled.png')} caption={px(result.output)} />
                </div>
                <Notice tone={FIDELITY_TONE[result.fidelity.tone]}>{result.fidelity.label}</Notice>
                <div className="flex flex-wrap gap-2">
                  <a href={fileUrl(result, 'upscaled.png', true)} className={`${LINK_BUTTON} btn-primary bg-navy text-white hover:bg-navy-700`}>
                    <Download className="h-4 w-4" /> Download upscaled PNG
                  </a>
                  <a
                    href={fileUrl(result, 'standard.png', true)}
                    title="A plain enlargement with no AI: nothing is added, but it is softer."
                    className={`${LINK_BUTTON} btn-secondary border border-line bg-white text-ink hover:border-navy/50 hover:text-navy`}
                  >
                    <Download className="h-4 w-4" /> Standard upscale (no AI)
                  </a>
                </div>
                <p className="text-[12.5px] leading-relaxed text-muted">Click an image to open it full size. The standard upscale is a plain enlargement of the original with nothing added; use it if the AI version changed anything that matters.</p>
              </div>
            </Card>
          ) : (
            <Card rule={false} className="rise min-h-48">
              <EmptyState icon={<ImageUp className="h-5 w-5" />} title="Original and upscaled, side by side">
                Choose an image on the left. You will see the original next to the AI version, with a match score and a plain enlargement to fall back on.
              </EmptyState>
            </Card>
          )}

          <div>
            <h2 className="rise mb-3 font-display text-lg font-semibold uppercase tracking-[0.08em]">Your recent upscales</h2>
            <Card rule={false} className="rise overflow-hidden" >
              {!recent && (
                <div className="flex items-center gap-2 p-5 text-muted">
                  <Spinner /> Loading
                </div>
              )}
              {recent && !recent.length && <EmptyState title="No upscales yet">Finished upscales are kept here for your sign-in.</EmptyState>}
              <ul className="stagger divide-y divide-line">
                {(recent ?? []).map((u) => (
                  <li key={u.id} className={`row-hover flex items-center hover:bg-navy-50/50 ${result?.id === u.id ? 'is-on bg-navy-50/60' : ''}`}>
                    <button type="button" onClick={() => setResult(u)} className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4 pr-2 text-left">
                      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[2px] border border-line bg-paper">
                        <img src={fileUrl(u, 'thumb.jpg')} alt="" className="h-full w-full object-contain" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{u.name}</div>
                        <div className="text-[13px] text-muted">
                          <span className="font-mono">{px(u.output)}</span> · {u.createdBy} · {new Date(u.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(u)}
                      disabled={deleting === u.id}
                      className="mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-[3px] text-muted transition-colors hover:bg-white hover:text-signal hover:shadow-card disabled:opacity-50"
                      title="Delete upscale"
                      aria-label={`Delete upscale of ${u.name}`}
                    >
                      {deleting === u.id ? <Spinner /> : <Trash2 className="h-4 w-4" />}
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
