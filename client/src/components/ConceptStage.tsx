import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Circle, LayoutTemplate, Maximize2, Plus, RefreshCw, Wand2 } from 'lucide-react';
import { api, ApiError, conceptUrl, stream, type ProjectPayload } from '../api';
import type { Catalog } from '../catalog';
import { Button, Notice, Spinner, StepBadge, fmtUsd } from './ui';
import { Lightbox } from './Lightbox';
import type { ConceptRecord, InstructionPlan } from '../../../shared/types';
import { MAX_PROOF_PAGES } from '../../../shared/proof';

type Props = { data: ProjectPayload; catalog: Catalog; onChange: (d: ProjectPayload) => void; reload: () => void };

export function ConceptStage({ data, catalog, onChange, reload }: Props) {
  const p = data.project;
  const exactDesign = !!p.uploads.exactDesigns?.length;
  const [live, setLive] = useState<Record<string, ConceptRecord>>({});
  const [partials, setPartials] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<ConceptRecord | null>(null);
  const [plans, setPlans] = useState<Record<string, InstructionPlan>>({});

  const concepts = useMemo(() => {
    const map = new Map(data.concepts.map((c) => [c.id, c]));
    for (const c of Object.values(live)) map.set(c.id, c);
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data.concepts, live]);

  // What the order still needs before concepts can be made, shown as a checklist.
  const checklist: { label: string; done: boolean }[] = [
    { label: 'Specification read', done: !!p.spec },
    { label: 'Customer wording or exact design added', done: !!p.wording?.blocks.length || exactDesign },
  ];
  if (!exactDesign && p.spec && p.spec.imageOption !== 'none') checklist.push({ label: 'Photo uploaded (or Image option set to No Image)', done: p.uploads.photos.length > 0 });
  const blockers = checklist.filter((c) => !c.done);

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
    <div className="@container relative mx-auto max-w-[1440px] px-4 py-5 md:px-6">
      {running && <div className="progress is-light absolute inset-x-0 top-0" aria-hidden />}
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-white">
            <StepBadge step="04" tone="light" />
            Concepts
          </h2>
          <p className="mt-1 text-[13.5px] leading-snug text-white/60">{exactDesign ? 'Both concepts preserve your exact design.' : 'Two layouts: Classic and Statement.'} Max quality at 1.5K (1536 px). Each selected image becomes its own proof page.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={blockers.length > 0} busy={running} onClick={() => runStream(`/projects/${p.id}/generate`, {})}>
            <Wand2 className="h-4 w-4" />
            {concepts.length ? 'Generate 2 new concepts' : 'Generate 2 concepts'}
          </Button>
        </div>
      </div>
      {blockers.length > 0 && (
        <ul className="fade-in mt-3 flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Before generating">
          {checklist.map((c) => (
            <li key={c.label} className={`flex items-center gap-1.5 text-[13px] ${c.done ? 'text-white/45' : 'text-white/85'}`}>
              {c.done ? <CheckCircle2 className="h-3.5 w-3.5 text-[#7fd1a6]" aria-hidden /> : <Circle className="h-3.5 w-3.5 text-bronze" aria-hidden />}
              {c.label}
            </li>
          ))}
        </ul>
      )}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      <div className={`stagger mt-5 grid ${wide ? 'grid-cols-1 gap-6' : 'grid-cols-1 gap-6 @[560px]:grid-cols-2 @[560px]:gap-x-6 @[560px]:gap-y-3'}`}>
        {catalog.presets.filter((preset) => preset.active !== false).map((preset) => (
          <PresetColumn
            key={preset.id}
            preset={preset}
            concepts={concepts.filter((c) => c.preset === preset.id)}
            data={data}
            partials={partials}
            ratio={ratio}
            running={running}
            plan={plans[preset.id]}
            wide={wide}
            onOpen={setLightbox}
            proofIds={p.proofConceptIds}
            onToggle={async (c, on) => {
              setError('');
              try { onChange(await api.post<ProjectPayload>(`/projects/${p.id}/proof-set`, { conceptId: c.id, on })); }
              catch (e) { setError((e as Error).message); }
            }}
            onRegenerate={(c) => runStream(`/concepts/${c.id}/regenerate`, {})}
            onFix={(c, instruction) => runStream(`/concepts/${c.id}/fix`, { instruction }, c.preset)}
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
        <Lightbox
          src={conceptUrl(lightbox, 'image.png')}
          title={`${catalog.presets.find((x) => x.id === lightbox.preset)?.label ?? lightbox.preset} concept`}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function PresetColumn({
  preset, concepts, data, partials, ratio, running, plan, wide, proofIds, onOpen, onToggle, onRegenerate, onFix, onUndo,
}: {
  preset: { id: string; label: string; description: string };
  wide: boolean;
  concepts: ConceptRecord[];
  data: ProjectPayload;
  partials: Record<string, string>;
  ratio: number;
  running: boolean;
  plan?: InstructionPlan;
  onOpen: (c: ConceptRecord) => void;
  proofIds: string[];
  onToggle: (c: ConceptRecord, on: boolean) => void;
  onRegenerate: (c: ConceptRecord) => void;
  onFix: (c: ConceptRecord, instruction: string) => void;
  onUndo: (c: ConceptRecord) => void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [fix, setFix] = useState('');
  const p = data.project;
  const current = concepts[index ?? concepts.length - 1] ?? null;
  // The page this version has on the proof (1-based), or 0 when it is not on it.
  const page = current ? proofIds.indexOf(current.id) + 1 : 0;
  const selected = page > 0;
  const full = proofIds.length >= MAX_PROOF_PAGES;
  const layout = data.layouts?.find((l) => l.preset === preset.id);
  const busy = current && (current.status === 'running' || current.status === 'queued');
  const partial = current ? partials[current.id] : undefined;
  const shownPlan = plan ?? current?.plan;
  const exactDesign = !!(current?.snapshot?.uploads ?? p.uploads).exactDesigns?.length;
  const planNote = shownPlan?.kind === 'refuse' ? shownPlan.reason
    : shownPlan?.kind === 'visual' ? exactDesign ? 'Sent to the image model as written. Select the edited version to put it on the proof; use the original artwork for production.' : 'Sent to the image model as written (changes the image only; the proof and vector file keep the current order)'
    : shownPlan ? `Interpreted as: ${shownPlan.restated} ${planScope(shownPlan)}` : '';

  return (
    <article
      aria-current={selected ? 'true' : undefined}
      className={`concept-column flex min-w-0 flex-col gap-3 rounded-[4px] border bg-stage-2/80 p-3.5 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm ${wide ? '' : '@[560px]:row-span-3 @[560px]:grid @[560px]:grid-cols-[minmax(0,1fr)] @[560px]:grid-rows-subgrid'} ${selected ? 'is-selected border-bronze' : 'border-white/10'}`}
    >
      <header className="min-w-0 border-b border-white/10 pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-white">
            <span className="h-3.5 w-[3px] rounded-sm bg-gold" aria-hidden />
            {preset.label}
          </h3>
          {selected && (
            <span className="flex shrink-0 items-center gap-1 rounded-[3px] bg-ok px-1.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-white">
              <Check className="h-3 w-3" /> {proofIds.length > 1 ? `Proof page ${page}` : 'On the proof'}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-white/55">{exactDesign ? 'Customer exact design, with the original composition preserved.' : preset.description}</p>
      </header>

      <div className="relative mx-auto w-full min-w-0 self-start" style={{ maxWidth: ratio < 1 ? 440 : '100%' }}>
        <div className="relative w-full" style={{ aspectRatio: String(ratio) }}>
          {current?.hasImage ? (
            <button className="group plaque-shadow concept-image absolute inset-0" onClick={() => onOpen(current)} aria-label="View full size">
              <img src={`${conceptUrl(current, 'preview.jpg')}?v=${current.id}`} alt={`${preset.label} concept`} className="fade-in h-full w-full object-fill" />
              <Maximize2 className="absolute right-2 bottom-2 h-4 w-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
            </button>
          ) : partial ? (
            <img src={partial} alt="" className="plaque-shadow absolute inset-0 h-full w-full object-fill" />
          ) : busy ? (
            <div className="skeleton absolute inset-0 rounded-[2px]" />
          ) : layout ? (
            <div className="group absolute inset-0 overflow-hidden rounded-[2px] ring-1 ring-white/10">
              <img src={`/api/projects/${p.id}/layout/${preset.id}?v=${encodeURIComponent(p.updatedAt)}`} alt="" className="fade-in h-full w-full object-fill opacity-70 transition-opacity duration-300 group-hover:opacity-90" />
              <span className="absolute top-2 left-2 flex items-center gap-1 rounded-[2px] bg-black/60 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-white/80">
                <LayoutTemplate className="h-3 w-3" aria-hidden /> Layout preview
              </span>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center rounded-[2px] border border-dashed border-white/15 bg-white/[0.02] px-4 text-center">
              <div className="text-white/45">
                <LayoutTemplate className="mx-auto mb-2 h-6 w-6 opacity-60" aria-hidden />
                <div className="text-[12.5px]">The layout drawing appears here once the order is read</div>
              </div>
            </div>
          )}
          {selected && (
            <span className="selected-check absolute top-2 left-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-ok text-white shadow-lg ring-2 ring-white/80" title={`This concept is page ${page} of the proof`} aria-hidden>
              {proofIds.length > 1 ? <span className="font-display text-[15px] font-bold">{page}</span> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
          )}
          {busy && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/65 px-2.5 py-2 text-[12.5px] text-white backdrop-blur-sm">
              <Spinner className="h-3.5 w-3.5" /> {partial ? 'Refining…' : 'Rendering… this takes about a minute'}
            </div>
          )}
        </div>
      </div>

      {current && (
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {concepts.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setIndex(i)}
                className={`h-6 min-w-6 rounded-[3px] px-1.5 font-mono text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-bronze ${c.id === current.id ? 'bg-white text-ink shadow-[0_2px_6px_-2px_rgba(0,0,0,0.6)]' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                aria-pressed={c.id === current.id}
                title={c.kind === 'fix' ? `Fix: ${c.instruction ?? c.note}` : c.kind === 'regenerate' ? 'Regenerated' : 'Original'}
              >
                v{i + 1} · {c.plan?.kind === 'spec' ? 'spec' : c.plan?.kind === 'wording' ? 'wording' : c.plan?.kind === 'edit' || c.kind === 'fix' ? 'edit' : c.kind === 'regenerate' ? 'new' : 'original'}
              </button>
            ))}
            <span className="ml-auto font-mono text-[11px] text-white/40">{fmtUsd(current.costUsd)}</span>
          </div>
          {(current.kind === 'fix' || current.plan?.kind === 'edit') && <p className="border-l-2 border-gold/60 pl-2 text-[12.5px] text-white/60">Fix: “{current.instruction ?? current.note}”</p>}
          {current.previous && current.plan && changesOrder(current.plan) && (
            <Button size="sm" variant="stage" disabled={running} onClick={() => onUndo(current)}>Undo order change</Button>
          )}
          {current.status === 'error' && <Notice tone="error">{current.error}</Notice>}
          {!!current.designContext?.examples.length && (
            <details className="text-[12px] text-white/55">
              <summary className="cursor-pointer">{current.kind === 'fix' ? 'Reviewed against' : 'Guided by'} {current.designContext.examples.length} Impact Signs examples</summary>
              <div className="mt-1 space-y-1 pl-2">{current.designContext.examples.map((example) => <div key={example.id}>{example.label}</div>)}</div>
            </details>
          )}
          {current.status === 'done' && current.designReview && (
            <div className={`flex items-start gap-1.5 text-[12px] ${current.designReview.checked && current.designReview.ok ? 'text-[#7fd1a6]' : current.designReview.checked ? 'text-[#ffb3a6]' : 'text-white/55'}`}>
              {current.designReview.checked && current.designReview.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
              <div>
                {current.designReview.message}
                {current.designReview.checks.filter((check) => !check.ok).map((check) => <div key={check.criterion}>{check.detail}</div>)}
              </div>
            </div>
          )}
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
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={selected || full ? 'stage' : 'primary'}
                  className="flex-1 whitespace-nowrap"
                  disabled={running || (!selected && full)}
                  onClick={() => onToggle(current, !selected)}
                  title={selected ? 'Take this image off the proof' : full ? `The proof is full (${MAX_PROOF_PAGES} pages). Take one off first.` : 'Make this image a page of the proof'}
                >
                  {selected ? <><Check className="h-3.5 w-3.5" /> On the proof · remove</>
                    : full ? `Proof is full (${MAX_PROOF_PAGES})`
                    : proofIds.length ? <><Plus className="h-3.5 w-3.5" /> Add as page {proofIds.length + 1}</>
                    : 'Use this one'}
                </Button>
                <Button size="sm" variant="stage" className="shrink-0" disabled={running} onClick={() => { setIndex(null); onRegenerate(current); }} title="Generate this layout again">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <form
                className="flex items-start gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (fix.trim() && !running) {
                    setIndex(null);
                    onFix(current, fix.trim());
                    setFix('');
                  }
                }}
              >
                <textarea
                  value={fix}
                  onChange={(e) => setFix(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter applies; Shift+Enter adds a line.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={2}
                  placeholder="Describe any change to this image"
                  className="min-h-[52px] min-w-0 flex-1 resize-y rounded-[3px] border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] leading-snug text-white placeholder:text-white/35 outline-none hover:border-white/30 focus:border-white/40"
                  aria-label="Describe a change for this image"
                  aria-describedby={planNote ? `plan-${preset.id}` : undefined}
                  maxLength={1000}
                />
                <Button size="sm" variant="stage" type="submit" className="shrink-0" disabled={running || !fix.trim()}>
                  Apply
                </Button>
              </form>
              <p className="text-[12px] text-white/50">Edits change this image using your instruction, at Max quality and 1.5K resolution.</p>
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

/** Order changes (catalog, wording, layout) also reach the proof and vector file; image edits do not. */
function changesOrder(plan: InstructionPlan): boolean {
  if (plan.kind === 'spec' || plan.kind === 'wording') return true;
  return plan.kind === 'edit' && !!(plan.specPatch || plan.wordingEdits || plan.layoutPatch || plan.placement);
}

function planScope(plan: InstructionPlan): string {
  const order = changesOrder(plan);
  const image = plan.kind === 'visual' || (plan.kind === 'edit' && !!plan.imageEdit);
  if (order && image) return '(layout and wording changes update the proof and vector file; the rest changes the image only)';
  if (order) return '(updates the proof and vector file)';
  return '(changes the image only; the vector file keeps the current layout)';
}
