import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Download, ExternalLink, FileCheck2, FileCog, AlertTriangle, X, XCircle } from 'lucide-react';
import { api, conceptUrl, type ProjectPayload } from '../api';
import { assetUrl, type Catalog } from '../catalog';
import { Button, EmptyState, Notice, Panel } from './ui';
import { conceptTag, outputTag, useMakeOutput, WordingCheckWarning } from './outputs';
import type { ConceptRecord, OutputRecord } from '../../../shared/types';
import { MAX_PROOF_PAGES } from '../../../shared/proof';

type Props = { data: ProjectPayload; catalog: Catalog; onChange: (d: ProjectPayload) => void };

export function OutputsPanel({ data, catalog, onChange }: Props) {
  const p = data.project;
  // The images on the proof, one page each, in page order.
  const pages = p.proofConceptIds.map((id) => data.concepts.find((c) => c.id === id)).filter((c): c is ConceptRecord => !!c);
  const selected = pages[0] ?? null;
  const content = selected?.snapshot ?? p;
  const exactDesign = !!(content.uploads ?? p.uploads).exactDesigns?.length;
  const proofs = data.outputs.filter((o) => o.kind === 'proof');
  const productions = data.outputs.filter((o) => o.kind === 'production');
  const { busy, error, check, notes, makeProof, makeProduction } = useMakeOutput(p.id, pages.map((c) => c.id), onChange);

  const finish = p.spec && catalog.catalog.finishes.find((f) => f.id === p.spec!.finish);
  const paint = p.spec && catalog.catalog.backgroundColors.find((f) => f.id === p.spec!.backgroundColor);

  return (
    <div>
      <Panel step="05" title="Customer proof" busy={busy === 'proof'}>
        {pages.length ? (
          <ProofPages pages={pages} data={data} catalog={catalog} onChange={onChange} finish={finish} paint={paint} />
        ) : (
          <EmptyState icon={<FileCheck2 className="h-5 w-5" />} title="Nothing on the proof yet" className="rounded-[3px] border border-dashed border-line py-7">
            Press “Use this one” under a concept, then “Add as page 2” (and 3) under others. Each image becomes its own page of one proof PDF, in the order you add them.
          </EmptyState>
        )}
        <ProofSettings data={data} catalog={catalog} onChange={onChange} />
        <Button className="mt-3 w-full" disabled={!selected} busy={busy === 'proof'} onClick={() => makeProof()}>
          <FileCheck2 className="h-4 w-4" /> {pages.length > 1 ? `Create ${pages.length}-page proof PDF` : 'Create proof PDF'}
        </Button>
        {error?.kind === 'proof' && <div className="mt-3"><Notice tone="error">{error.message}</Notice></div>}
        {check && <div className="mt-3"><WordingCheckWarning check={check} onConfirm={() => makeProof(true)} /></div>}
        <OutputList outputs={proofs} concepts={data.concepts} catalog={catalog} />
      </Panel>

      <Panel step="06" title="Vector production PDF" busy={busy === 'production'}>
        <p className="text-[13.5px] leading-relaxed text-muted">
          {exactDesign ? 'One-ink vector PDF at full plaque size, traced from the saved exact design artwork. Colors become raised metal; check fine details and letter heights against the original. Image-only concept edits are not included.' : <>One-ink production file at full plaque size: black = raised metal, white = recessed field, all text outlined, photo area left as a placeholder. Built from the layout of {pages.length > 1 ? 'page 1 of the proof' : 'the concept on the proof'}{selected ? ` (${conceptTag(selected, data.concepts, catalog)})` : ''}.</>}
        </p>
        <Button className="mt-3 w-full" variant="secondary" disabled={!content.spec || (!content.wording?.blocks.length && !exactDesign)} busy={busy === 'production'} onClick={makeProduction}>
          <FileCog className="h-4 w-4" /> Create vector PDF
        </Button>
        {notes.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {notes.map((n, i) => (
              <li key={i}>
                <Notice tone="info">{n}</Notice>
              </li>
            ))}
          </ul>
        )}
        <OutputList outputs={productions} concepts={data.concepts} catalog={catalog} />
        {error?.kind === 'production' && <div className="mt-3"><Notice tone="error">{error.message}</Notice></div>}
      </Panel>
    </div>
  );
}

/** The images going on the proof, as numbered pages: reorder them or take one off. */
function ProofPages({ pages, data, catalog, onChange, finish, paint }: Props & {
  pages: ConceptRecord[];
  finish?: Catalog['catalog']['finishes'][number] | null | false;
  paint?: Catalog['catalog']['backgroundColors'][number] | null | false;
}) {
  const p = data.project;
  const [error, setError] = useState('');
  const send = async (body: Record<string, unknown>) => {
    setError('');
    try {
      onChange(await api.post<ProjectPayload>(`/projects/${p.id}/proof-set`, body));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const move = (i: number, by: -1 | 1) => {
    const ids = pages.map((c) => c.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    send({ order: ids });
  };
  const iconButton = 'grid h-7 w-7 place-items-center rounded-[3px] border border-line bg-white text-graphite hover:border-navy/50 hover:text-navy hover:shadow-card disabled:opacity-30 disabled:shadow-none disabled:hover:border-line disabled:hover:text-graphite';
  return (
    <div>
      <div className="label">{pages.length > 1 ? `On the proof · ${pages.length} pages` : 'On the proof'}</div>
      <ol className="stagger mt-1.5 space-y-2">
        {pages.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2.5 rounded-[3px] border border-line bg-white p-2 shadow-card transition-[box-shadow,border-color] hover:border-navy/30 hover:shadow-card-hover">
            <div className="relative shrink-0">
              <img src={conceptUrl(c, 'preview.jpg')} alt={`Page ${i + 1}`} className="h-16 w-auto max-w-[72px] rounded-[2px] bg-stage object-contain shadow-[0_6px_14px_-8px_rgba(0,0,0,0.7)]" />
              <span className="absolute -top-1.5 -left-1.5 grid h-5 w-5 place-items-center rounded-full bg-navy font-mono text-[11px] font-semibold text-white ring-2 ring-white" aria-hidden>{i + 1}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[11px] font-semibold uppercase tracking-wider text-muted">Page {i + 1}</div>
              <div className="truncate font-display text-[14px] font-semibold text-ink">{conceptTag(c, data.concepts, catalog)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {pages.length > 1 && (
                <>
                  <button className={iconButton} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move page ${i + 1} up`} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button className={iconButton} disabled={i === pages.length - 1} onClick={() => move(i, 1)} aria-label={`Move page ${i + 1} down`} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                </>
              )}
              <button className={iconButton} onClick={() => send({ conceptId: c.id, on: false })} aria-label={`Take page ${i + 1} off the proof`} title="Take off the proof"><X className="h-3.5 w-3.5" /></button>
            </div>
          </li>
        ))}
      </ol>
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
      {(finish || paint) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {finish && (
            <div className="flex items-center gap-2">
              {finish.asset && <img src={assetUrl(finish.asset)} alt="" className="h-7 w-7 rounded-[2px] border border-line object-cover shadow-card" />}
              <span className="text-ink">{finish.proofLabel ?? finish.label}</span>
            </div>
          )}
          {paint && (
            <div className="flex items-center gap-2">
              {paint.asset ? <img src={assetUrl(paint.asset)} alt="" className="h-7 w-7 rounded-[2px] border border-line object-cover shadow-card" /> : <span className="h-7 w-7 rounded-[2px] border border-line shadow-card" style={{ background: paint.hex }} />}
              <span className="text-ink">{paint.label} · Paint Fill</span>
            </div>
          )}
        </div>
      )}
      {pages.length < MAX_PROOF_PAGES && <p className="mt-2 text-[12px] text-muted">Want more pages? Press “Add as page {pages.length + 1}” under another concept (up to {MAX_PROOF_PAGES}).</p>}
    </div>
  );
}

function ProofSettings({ data, onChange }: Props) {
  const p = data.project;
  const [desc, setDesc] = useState(p.proofDescription ?? '');
  const [note, setNote] = useState(p.proofNote ?? '');
  const [error, setError] = useState('');
  useEffect(() => setDesc(p.proofDescription ?? ''), [p.proofDescription]);
  useEffect(() => setNote(p.proofNote ?? ''), [p.proofNote]);
  const save = async (patch: Record<string, unknown>) => {
    setError('');
    try {
      onChange(await api.patch<ProjectPayload>(`/projects/${p.id}`, patch));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-3">
      <label className="block">
        <span className="label flex items-center justify-between">
          Description
          {p.proofDescription && (
            <button className="text-[11px] normal-case tracking-normal text-accent hover:underline" onClick={() => save({ proofDescription: null })}>
              Use automatic
            </button>
          )}
        </span>
        <textarea
          className="mt-1.5 h-28 w-full resize-y rounded-[3px] border border-line px-2.5 py-2 text-[13.5px] leading-snug outline-none transition-colors focus:border-navy"
          value={desc || data.autoDescription || ''}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc && desc !== (p.proofDescription ?? '') && desc !== data.autoDescription && save({ proofDescription: desc })}
          aria-label="Proof description"
        />
        <span className="text-[12px] text-muted">{p.proofDescription ? 'Edited by hand.' : 'Written from the order; edit it to override. It goes across the top of the proof, or bottom right when it is long.'}</span>
      </label>
      <label className="block">
        <span className="label">Red note under the plaque (optional)</span>
        <textarea
          className="mt-1.5 h-14 w-full resize-y rounded-[3px] border border-line px-2.5 py-2 text-[13.5px] leading-snug outline-none transition-colors focus:border-navy"
          placeholder="Note: Small letters are currently at minimum required height (1/4’’)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (p.proofNote ?? '') && save({ proofNote: note || null })}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** Newest first; "Latest" marks the newest file of each layout, since each layout is its own option. */
function OutputList({ outputs, concepts, catalog }: { outputs: OutputRecord[]; concepts: ConceptRecord[]; catalog: Catalog }) {
  if (!outputs.length) return null;
  const seen = new Set<string>();
  return (
    <ul className="stagger mt-4 space-y-3">
      {outputs.map((o, i) => {
        const layout = o.presets?.join('+') ?? o.preset ?? concepts.find((c) => c.id === o.conceptId)?.preset ?? '';
        const latest = !seen.has(layout);
        seen.add(layout);
        return <OutputItem key={o.id} o={o} tag={outputTag(o, concepts, catalog)} latest={latest} open={i === 0} />;
      })}
    </ul>
  );
}

function OutputItem({ o, tag, latest, open: openFirst }: { o: OutputRecord; tag: string; latest: boolean; open: boolean }) {
  const [previewOk, setPreviewOk] = useState(true);
  const [open, setOpen] = useState(openFirst);
  const pageCount = o.conceptIds?.length ?? 1;
  const [page, setPage] = useState(1);
  return (
    <li className={`rounded-[3px] border bg-white transition-[box-shadow,border-color] ${open ? 'border-navy/30 shadow-card' : 'border-line hover:border-navy/30'}`}>
      <button className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium text-ink">{o.fileName}</span>
          <span className="font-mono text-[11px] text-muted">
            {pageCount > 1 && <span className="mr-1.5 font-display font-semibold uppercase tracking-wider text-navy">{pageCount} pages</span>}
            {tag && <span className="mr-1.5 font-display font-semibold uppercase tracking-wider text-graphite">From {tag}</span>}
            {new Date(o.createdAt).toLocaleString()}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {latest && <span className="rounded-[3px] bg-navy-50 px-1.5 py-[1px] font-display text-[11px] font-semibold uppercase tracking-wider text-navy">Latest</span>}
          <ChevronDown className="chev h-4 w-4 text-muted" aria-hidden />
        </span>
      </button>
      {open && (
        <div className="fade-in space-y-2.5 border-t border-line p-3">
          {previewOk && (
            <a href={`/api/outputs/${o.id}/download?inline=1`} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-[2px] border border-line bg-paper p-2 transition-colors hover:border-navy/40">
              <img key={page} src={`/api/outputs/${o.id}/preview.png${page > 1 ? `?page=${page}` : ''}`} alt={`${o.fileName} preview, page ${page}`} className="fade-in mx-auto max-h-72 object-contain shadow-[0_10px_24px_-14px_rgba(31,38,64,0.5)] transition-transform duration-300 group-hover:scale-[1.01]" onError={() => setPreviewOk(false)} />
            </a>
          )}
          {previewOk && pageCount > 1 && (
            <div className="flex gap-1.5" role="group" aria-label="Proof pages">
              {Array.from({ length: pageCount }, (_, i) => (
                <button key={i} onClick={() => setPage(i + 1)} aria-pressed={page === i + 1} className={`h-7 flex-1 rounded-[3px] border font-display text-[12px] font-semibold tracking-wide ${page === i + 1 ? 'border-navy bg-navy text-white' : 'border-line text-ink hover:border-navy/50'}`}>
                  Page {i + 1}
                </button>
              ))}
            </div>
          )}
          {o.preflight && (
            <ul className="space-y-1">
              {o.preflight.map((item) => (
                <li key={item.label} className="flex items-start gap-2 text-[12.5px]">
                  {item.ok ? (
                    <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-ok" />
                  ) : item.warnOnly ? (
                    <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber" />
                  ) : (
                    <XCircle className="mt-px h-4 w-4 shrink-0 text-signal" />
                  )}
                  <span>
                    <span className="font-medium">{item.label}.</span> <span className="text-muted">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <a href={`/api/outputs/${o.id}/download`} className="btn-primary inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-navy px-3 font-display text-[13px] font-semibold tracking-wide text-white transition-[transform,box-shadow,background-color] duration-150 hover:bg-navy-700">
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <a href={`/api/outputs/${o.id}/download?inline=1`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[3px] border border-line bg-white px-3 font-display text-[13px] font-semibold tracking-wide text-ink transition-colors hover:border-navy/50 hover:text-navy">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </div>
        </div>
      )}
    </li>
  );
}
