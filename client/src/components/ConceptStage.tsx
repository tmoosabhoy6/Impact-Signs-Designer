import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Maximize2, RefreshCw, Wand2, X } from 'lucide-react';
import { api, ApiError, conceptUrl, stream, type ProjectPayload } from '../api';
import type { Catalog } from '../catalog';
import { Button, Notice, Spinner, fmtUsd } from './ui';
import type { ConceptRecord, InstructionPlan } from '../../../shared/types';

type Props = { data: ProjectPayload; catalog: Catalog; onChange: (d: ProjectPayload) => void; reload: () => void };

const QUALITY = [
  { id: 'medium', label: 'Draft' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
];

export function ConceptStage({ data, catalog, onChange, reload }: Props) {
  const p = data.project;
  const [live, setLive] = useState<Record<string, ConceptRecord>>({});
  const [partials, setPartials] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState('high');
  const [lightbox, setLightbox] = useState<ConceptRecord | null>(null);
  const [plans, setPlans] = useState<Record<string, InstructionPlan>>({});

  const concepts = useMemo(() => {
    const map = new Map(data.concepts.map((c) => [c.id, c]));
    for (const c of Object.values(live)) map.set(c.id, c);
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data.concepts, live]);

  const blockers: string[] = [];
  if (!p.spec) blockers.push('read the specification');
  if (!p.wording?.blocks.length) blockers.push('add the customer wording');
  if (p.spec && p.spec.imageOption !== 'none' && !p.uploads.photo) blockers.push('upload the photo (or set Image option to No Image)');

  const runStream = async (url: string, body: unknown, preset?: string) => {
    setRunning(true);
    setError('');
    try {
      await stream(url, body, (e) => {
        if (e.type === 'plan' && preset) setPlans((m) => ({ ...m, [preset]: e.plan }));
        if (e.type === 'start') setLive((m) => ({ ...m, ...Object.fromEntries(e.concepts.map((c) => [c.id, c])) }));
        if (e.type === 'concept') setLive((m) => ({ ...m, [e.concept.id]: e.concept }));
        if (e.type === 'partial') setPartials((m) => ({ ...m, [e.conceptId]: e.image }));
      });
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && preset) {
        setPlans((m) => ({ ...m, [preset]: { kind: 'refuse', reason: e.message, nearestOptions: Array.isArray(e.data.nearestOptions) ? e.data.nearestOptions as string[] : [] } }));
      } else setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const ratio = p.spec ? p.spec.widthIn / p.spec.heightIn : 2 / 3;
  const wide = ratio > 1.15;

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-white">
            <span className="mr-2 font-mono text-[12px] text-bronze">04</span>Concepts
          </h2>
          <p className="text-[13px] text-white/55">Three production-realistic layouts. Pick one to send to the proof.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] text-white/60">
            Quality
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="h-8 rounded-[3px] border border-white/15 bg-white/10 px-1.5 text-[13px] text-white outline-none focus:border-white/40"
            >
              {QUALITY.map((q) => (
                <option key={q.id} value={q.id} className="text-ink">
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={blockers.length > 0} busy={running} onClick={() => runStream(`/projects/${p.id}/generate`, { quality })}>
            <Wand2 className="h-4 w-4" />
            {concepts.length ? 'Generate 3 new concepts' : 'Generate 3 concepts'}
          </Button>
        </div>
      </div>
      {blockers.length > 0 && <p className="mt-2 text-[13px] text-white/60">To generate, first {blockers.join(', ')}.</p>}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      <div className={`mt-5 grid gap-5 ${wide ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'}`}>
        {catalog.presets.map((preset) => (
          <PresetColumn
            key={preset.id}
            preset={preset}
            concepts={concepts.filter((c) => c.preset === preset.id)}
            data={data}
            partials={partials}
            ratio={ratio}
            running={running}
            plan={plans[preset.id]}
            onOpen={setLightbox}
            onSelect={async (c) => {
              setError('');
              try { onChange(await api.post<ProjectPayload>(`/projects/${p.id}/select`, { conceptId: c.id })); }
              catch (e) { setError((e as Error).message); }
            }}
            onRegenerate={(c) => runStream(`/concepts/${c.id}/regenerate`, { quality })}
            onFix={(c, instruction) => runStream(`/concepts/${c.id}/fix`, { instruction, quality }, c.preset)}
            onUndo={async (c) => {
              setRunning(true);
              setError('');
              try {
                onChange(await api.post<ProjectPayload>(`/concepts/${c.id}/undo`));
                setPlans((m) => { const next = { ...m }; delete next[c.preset]; return next; });
              } catch (e) { setError((e as Error).message); }
              finally { setRunning(false); }
            }}
          />
        ))}
      </div>

      {lightbox && (
        <div role="dialog" aria-modal className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
          <img src={conceptUrl(lightbox, 'image.png')} alt="Concept full size" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

function PresetColumn({
  preset, concepts, data, partials, ratio, running, plan, onOpen, onSelect, onRegenerate, onFix, onUndo,
}: {
  preset: { id: string; label: string; description: string };
  concepts: ConceptRecord[];
  data: ProjectPayload;
  partials: Record<string, string>;
  ratio: number;
  running: boolean;
  plan?: InstructionPlan;
  onOpen: (c: ConceptRecord) => void;
  onSelect: (c: ConceptRecord) => void;
  onRegenerate: (c: ConceptRecord) => void;
  onFix: (c: ConceptRecord, instruction: string) => void;
  onUndo: (c: ConceptRecord) => void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [fix, setFix] = useState('');
  const p = data.project;
  const current = concepts[index ?? concepts.length - 1] ?? null;
  const selected = current && p.selectedConceptId === current.id;
  const layout = data.layouts?.find((l) => l.preset === preset.id);
  const busy = current && (current.status === 'running' || current.status === 'queued');
  const partial = current ? partials[current.id] : undefined;
  const shownPlan = plan ?? current?.plan;
  const planNote = shownPlan?.kind === 'refuse' ? shownPlan.reason
    : shownPlan?.kind === 'visual' ? 'Visual edit to this image'
    : shownPlan ? `Interpreted as: ${shownPlan.restated} (updates the proof and vector file)` : '';

  return (
    <article className={`flex flex-col rounded-[4px] border bg-stage-2/70 p-3 ${selected ? 'border-bronze ring-1 ring-bronze' : 'border-white/10'}`}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-white">{preset.label}</h3>
          <p className="text-[12px] leading-snug text-white/50">{preset.description}</p>
        </div>
        {selected && (
          <span className="shrink-0 rounded-[3px] bg-bronze px-1.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-ink">Selected</span>
        )}
      </header>

      <div className="relative mx-auto w-full" style={{ maxWidth: ratio < 1 ? 340 : '100%' }}>
        <div className="relative w-full" style={{ aspectRatio: String(ratio) }}>
          {current?.hasImage ? (
            <button className="group plaque-shadow absolute inset-0" onClick={() => onOpen(current)} aria-label="View full size">
              <img src={`${conceptUrl(current, 'preview.jpg')}?v=${current.id}`} alt={`${preset.label} concept`} className="h-full w-full object-fill" />
              <Maximize2 className="absolute right-2 bottom-2 h-4 w-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
            </button>
          ) : partial ? (
            <img src={partial} alt="" className="plaque-shadow absolute inset-0 h-full w-full object-fill" />
          ) : busy ? (
            <div className="skeleton absolute inset-0" />
          ) : layout ? (
            <div className="absolute inset-0">
              <img src={`/api/projects/${p.id}/layout/${preset.id}?v=${encodeURIComponent(p.updatedAt)}`} alt="" className="h-full w-full object-fill opacity-60" />
              <span className="absolute top-2 left-2 rounded-[2px] bg-black/60 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-white/80">Layout preview</span>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center border border-dashed border-white/15 text-[12px] text-white/40">Layout appears once the order is read</div>
          )}
          {busy && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-2 py-1.5 text-[12px] text-white">
              <Spinner className="h-3.5 w-3.5" /> {partial ? 'Refining…' : 'Rendering… this takes about a minute'}
            </div>
          )}
        </div>
      </div>

      {current && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {concepts.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setIndex(i)}
                className={`h-6 min-w-6 rounded-[3px] px-1.5 font-mono text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze ${c.id === current.id ? 'bg-white text-ink' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                aria-pressed={c.id === current.id}
                title={c.kind === 'fix' ? `Fix: ${c.note}` : c.kind === 'regenerate' ? 'Regenerated' : 'Original'}
              >
                v{i + 1} · {c.plan?.kind === 'spec' ? 'spec' : c.plan?.kind === 'wording' ? 'wording' : c.kind === 'fix' ? 'edit' : c.kind === 'regenerate' ? 'new' : 'original'}
              </button>
            ))}
            <span className="ml-auto font-mono text-[11px] text-white/40">{fmtUsd(current.costUsd)}</span>
          </div>
          {current.kind === 'fix' && <p className="text-[12px] text-white/50">Fix: “{current.note}”</p>}
          {current.previous && (current.plan?.kind === 'spec' || current.plan?.kind === 'wording') && (
            <Button size="sm" variant="stage" disabled={running} onClick={() => onUndo(current)}>Undo order change</Button>
          )}
          {current.status === 'error' && <Notice tone="error">{current.error}</Notice>}
          {current.status === 'done' && current.spellcheck && (
            <div className={`flex items-start gap-1.5 text-[12px] ${current.spellcheck.ok ? (current.spellcheck.checked ? 'text-[#7fd1a6]' : 'text-white/55') : 'text-[#ffb3a6]'}`}>
              {current.spellcheck.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
              <div>
                {current.spellcheck.message}
                {current.spellcheck.differences.map((d, i) => (
                  <div key={i} className="font-mono text-[11px]">
                    expected “{d.expected}” · image shows “{d.seen}”
                  </div>
                ))}
              </div>
            </div>
          )}
          {current.hasImage && (
            <>
              <div className="flex gap-2">
                <Button size="sm" variant={selected ? 'stage' : 'primary'} className="flex-1" disabled={!!selected || running} onClick={() => onSelect(current)}>
                  {selected ? 'Selected for proof' : 'Use this one'}
                </Button>
                <Button size="sm" variant="stage" disabled={running} onClick={() => { setIndex(null); onRegenerate(current); }} title="Generate this layout again">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (fix.trim()) {
                    setIndex(null);
                    onFix(current, fix.trim());
                    setFix('');
                  }
                }}
              >
                <input
                  value={fix}
                  onChange={(e) => setFix(e.target.value)}
                  placeholder='Fix: e.g. "correct the spelling of Feulner"'
                  className="h-8 min-w-0 flex-1 rounded-[3px] border border-white/15 bg-white/5 px-2 text-[12.5px] text-white placeholder:text-white/35 outline-none focus:border-white/40"
                  aria-label="Describe a fix for this image"
                  aria-describedby={planNote ? `plan-${preset.id}` : undefined}
                  maxLength={500}
                />
                <Button size="sm" variant="stage" type="submit" disabled={running || !fix.trim()}>
                  Apply
                </Button>
              </form>
              {planNote && <p id={`plan-${preset.id}`} role="status" className={`text-[12px] ${shownPlan?.kind === 'refuse' ? 'text-[#ffb3a6]' : 'text-white/65'}`}>{planNote}</p>}
              {shownPlan?.kind === 'refuse' && shownPlan.nearestOptions.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Available alternatives">
                  {shownPlan.nearestOptions.map((option) => (
                    <button key={option} type="button" onClick={() => setFix(`use ${option}`)} className="rounded-[3px] border border-white/20 bg-white/10 px-2 py-1 text-[12px] text-white/80 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze">{option}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
