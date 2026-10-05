import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FilePlus2, X } from 'lucide-react';
import type { Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Card, EmptyState, Notice, Spinner } from '../components/ui';
import { MERGE_MAX_FILES, MERGE_UPLOAD_MB, type MergePreview } from '../../../shared/merge';

interface Item {
  key: string;
  file: File;
  /** Filled in once the server has read the file; `error` if it could not. */
  info?: MergePreview;
  error?: string;
}

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
let nextKey = 0;

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || `Request failed (${res.status})`;
}

export function Merger({ me }: { me: Me }) {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ url: string; count: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const urls = useRef(new Map<string, string>());

  // Each blob URL is released when it is replaced or the page closes.
  useEffect(() => {
    const open = urls.current;
    return () => open.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  useEffect(() => () => {
    if (done) URL.revokeObjectURL(done.url);
  }, [done]);

  const fileUrl = (it: Item) => {
    let u = urls.current.get(it.key);
    if (!u) {
      u = URL.createObjectURL(it.file);
      urls.current.set(it.key, u);
    }
    return u;
  };

  async function read(it: Item) {
    const fd = new FormData();
    fd.append('file', it.file);
    try {
      const res = await fetch('/api/merge/preview', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await readError(res));
      const info = (await res.json()) as MergePreview;
      setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, info } : x)));
    } catch (e) {
      setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, error: (e as Error).message } : x)));
    }
  }

  function add(list: FileList | File[] | null | undefined) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setError('');
    setDone(null);
    const pdfs = picked.filter(isPdf);
    const room = MERGE_MAX_FILES - items.length;
    const take = pdfs.slice(0, Math.max(0, room));
    const notes: string[] = [];
    if (pdfs.length < picked.length) notes.push(`${picked.length - pdfs.length} file${picked.length - pdfs.length === 1 ? ' was' : 's were'} skipped because only PDFs can be merged.`);
    if (pdfs.length > take.length) notes.push(`Only ${MERGE_MAX_FILES} PDFs fit in one merge, so ${pdfs.length - take.length} ${pdfs.length - take.length === 1 ? 'was' : 'were'} left out.`);
    setNotice(notes.join(' '));
    const fresh = take.map((file): Item => ({ key: `m${nextKey++}`, file }));
    setItems((cur) => [...cur, ...fresh]);
    fresh.forEach((it) => void read(it));
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    setDone(null);
    setItems((cur) => {
      const next = [...cur];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      return next;
    });
  };
  const remove = (key: string) => {
    setDone(null);
    setItems((cur) => cur.filter((x) => x.key !== key));
    const u = urls.current.get(key);
    if (u) URL.revokeObjectURL(u);
    urls.current.delete(key);
  };

  const unreadable = items.filter((x) => x.error).length;
  const loading = items.some((x) => !x.info && !x.error);
  const totalPages = items.reduce((n, x) => n + (x.info?.pages ?? 0), 0);
  const canMerge = items.length >= 2 && !unreadable && !loading;

  async function merge() {
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const fd = new FormData();
      for (const it of items) fd.append('files', it.file);
      const res = await fetch('/api/merge', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await readError(res));
      const url = URL.createObjectURL(await res.blob());
      setDone({ url, count: items.length });
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged-proofs.pdf';
      a.click();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
                <h1 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">Proof Merger</h1>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">Joins up to {MERGE_MAX_FILES} proof PDFs into one PDF, in the order you choose. Every page of every file is kept.</p>
              </div>

              <label
                className={`block cursor-pointer rounded-[3px] border border-dashed p-4 text-center transition-[background-color,border-color,box-shadow] duration-150 ${dragging ? 'drop-active border-navy bg-navy-50' : 'border-line bg-paper/60 hover:border-navy/50 hover:bg-navy-50/60'}`}
                onDragOver={(e) => {
                  if (dragKey) return;
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  if (dragKey) return;
                  e.preventDefault();
                  setDragging(false);
                  add(e.dataTransfer.files);
                }}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    add(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="flex flex-col items-center gap-2 py-4 text-muted">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-navy-50 text-navy"><FilePlus2 className="h-5 w-5" /></span>
                  <span className="text-[14px] font-medium text-ink">Drop proof PDFs here, or click to choose</span>
                  <span className="text-[12px]">Up to {MERGE_MAX_FILES} PDFs, {MERGE_UPLOAD_MB} MB each</span>
                </div>
              </label>

              {notice && <Notice tone="warn">{notice}</Notice>}
              {unreadable > 0 && <Notice tone="error">{unreadable === 1 ? 'One file' : `${unreadable} files`} could not be read. Remove {unreadable === 1 ? 'it' : 'them'} to continue.</Notice>}
              {error && <Notice tone="error">{error}</Notice>}
              {done && (
                <Notice tone="ok">
                  Merged {done.count} PDFs. If the download did not start,{' '}
                  <a href={done.url} download="merged-proofs.pdf" className="font-semibold underline">download the merged PDF</a>.
                </Notice>
              )}
              <Button className="w-full" onClick={merge} busy={busy} disabled={!canMerge}>
                <Download className="h-4 w-4" aria-hidden /> Merge into one PDF
              </Button>
              <p className="text-[12.5px] text-muted">
                {items.length < 2 ? 'Add at least two PDFs.' : loading ? 'Reading your files.' : `${items.length} PDFs, ${totalPages} page${totalPages === 1 ? '' : 's'} in total.`}
              </p>
            </div>
          </Card>
        </div>

        <section className="min-w-0">
          <div className="rise mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">Order</h2>
            {items.length > 1 && <span className="text-[13px] text-muted">Drag a card, or use the arrows. Page 1 of the merged PDF is the first card.</span>}
          </div>
          {!items.length ? (
            <Card rule={false} className="rise min-h-48">
              <EmptyState icon={<FilePlus2 className="h-5 w-5" />} title="Your proofs, in order">
                Add the PDFs on the left. Each shows up here as a card with a preview, and you can set the order before merging.
              </EmptyState>
            </Card>
          ) : (
            <ol className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((it, i) => (
                <li
                  key={it.key}
                  draggable
                  onDragStart={() => setDragKey(it.key)}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    setOverKey(it.key);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = items.findIndex((x) => x.key === dragKey);
                    move(from, i);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  className={`card group relative min-w-0 cursor-grab transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-card-hover active:cursor-grabbing ${dragKey === it.key ? 'opacity-40' : ''} ${overKey === it.key && dragKey !== it.key ? 'border-navy ring-2 ring-navy/30' : ''}`}
                >
                  <a href={fileUrl(it)} target="_blank" rel="noreferrer" draggable={false} title="Open this PDF in a new tab" className="relative block aspect-[3/4] overflow-hidden border-b border-line bg-paper">
                    {it.info ? (
                      <img src={it.info.image} alt={`Page 1 of ${it.file.name}`} draggable={false} className="fade-in absolute inset-0 h-full w-full object-contain p-1.5" />
                    ) : it.error ? (
                      <span className="absolute inset-0 grid place-items-center p-3 text-center text-[12.5px] text-signal">{it.error}</span>
                    ) : (
                      <span className="absolute inset-0 grid place-items-center text-muted"><Spinner /></span>
                    )}
                    <span className="absolute left-2 top-2 grid h-6 min-w-6 place-items-center rounded-[3px] bg-navy px-1 font-mono text-[12px] font-medium text-white shadow-card">{i + 1}</span>
                  </a>
                  <div className="space-y-1.5 p-2.5">
                    <div className="truncate text-[13px] font-medium" title={it.file.name}>{it.file.name}</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-muted">{it.info ? `${it.info.pages} page${it.info.pages === 1 ? '' : 's'}` : ''}</span>
                      <span className="flex items-center">
                        <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="grid h-7 w-7 place-items-center rounded-[3px] text-muted transition-colors hover:bg-navy-50 hover:text-navy disabled:opacity-30 disabled:hover:bg-transparent" aria-label={`Move ${it.file.name} earlier`} title="Move earlier">
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} className="grid h-7 w-7 place-items-center rounded-[3px] text-muted transition-colors hover:bg-navy-50 hover:text-navy disabled:opacity-30 disabled:hover:bg-transparent" aria-label={`Move ${it.file.name} later`} title="Move later">
                          <ArrowRight className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => remove(it.key)} className="grid h-7 w-7 place-items-center rounded-[3px] text-muted transition-colors hover:bg-navy-50 hover:text-signal" aria-label={`Remove ${it.file.name}`} title="Remove">
                          <X className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
