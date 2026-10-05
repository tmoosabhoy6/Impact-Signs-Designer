import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { api, type ProjectPayload } from '../api';
import type { Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Notice, Spinner } from '../components/ui';
import { OrderPanel } from '../components/OrderPanel';
import { ConceptStage } from '../components/ConceptStage';
import { OutputsPanel } from '../components/OutputsPanel';
import type { Catalog } from '../catalog';

function StepTracker({ data }: { data: ProjectPayload }) {
  const p = data.project;
  const steps = [
    { label: 'Order', done: !!p.spec && !!p.wording?.blocks.length },
    { label: 'Concepts', done: data.concepts.some((c) => c.hasImage) },
    { label: 'Proof', done: data.outputs.some((o) => o.kind === 'proof') },
    { label: 'Vector PDF', done: data.outputs.some((o) => o.kind === 'production') },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="hidden items-center gap-1 lg:flex" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          <span
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 py-1 font-display text-[12px] font-semibold uppercase tracking-wider transition-colors duration-300 ${
              s.done ? 'text-ok' : i === current ? 'bg-navy text-white' : 'text-muted'
            }`}
          >
            {s.done ? <Check className="h-3.5 w-3.5" /> : <span className="font-mono">{String(i + 1).padStart(2, '0')}</span>}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-line" />}
        </li>
      ))}
    </ol>
  );
}

/** Side panel widths: the narrowest that still fits the order sheet / proof settings, and a share of the window. */
const PANEL_MIN = 280;
const panelMax = () => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.42));
const STORAGE = 'pps.panels';

interface Widths {
  left: number;
  right: number;
}

/**
 * The three sections of the workspace. The order sheet and the proof panel keep their own widths;
 * the concepts take the rest. The widths follow the work (the next section opens up a little as a
 * step is completed) until the designer drags a handle, after which they keep what was set.
 * Double-clicking a handle goes back to following the work.
 */
function useWorkspaceWidths(data: ProjectPayload) {
  const wide = useMediaQuery('(min-width: 87.5rem)');
  const desktop = useMediaQuery('(min-width: 64rem)');
  const [manual, setManual] = useState<Widths | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Widths | null;
      return saved && saved.left >= PANEL_MIN && saved.right >= PANEL_MIN ? saved : null;
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);

  const p = data.project;
  const orderDone = !!p.spec && !!p.wording?.blocks.length;
  const concepts = data.concepts.some((c) => c.hasImage);
  const selected = !!p.selectedConceptId;
  // The flow: the order sheet has the room first, then the concepts, then the proof panel.
  const base: Widths = wide ? { left: 380, right: 340 } : { left: 340, right: 300 };
  const auto: Widths = !orderDone
    ? { left: base.left + 50, right: base.right - 20 }
    : !concepts
      ? { left: base.left, right: base.right - 10 }
      : selected
        ? { left: base.left - 20, right: base.right + 40 }
        : { left: base.left - 10, right: base.right };
  const widths = manual ?? auto;

  const startDrag = useCallback((side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = manual ?? auto;
    setDragging(side);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const next = { ...start, [side]: Math.min(panelMax(), Math.max(PANEL_MIN, side === 'left' ? start.left + dx : start.right - dx)) };
      setManual(next);
    };
    const up = () => {
      setDragging(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setManual((m) => {
        try {
          if (m) localStorage.setItem(STORAGE, JSON.stringify(m));
        } catch {
          // Private windows may refuse storage; the widths still apply for this visit.
        }
        return m;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [manual, auto.left, auto.right]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setManual(null);
    try {
      localStorage.removeItem(STORAGE);
    } catch {
      // ignore
    }
  }, []);

  return { desktop, widths, dragging, startDrag, reset, manual: !!manual };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

function Handle({ side, onDrag, onReset, active }: { side: 'left' | 'right'; onDrag: (e: React.PointerEvent<HTMLDivElement>) => void; onReset: () => void; active: boolean }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize the order panel' : 'Resize the proof panel'}
      title="Drag to resize · double-click to let the layout follow your work"
      className={`panel-handle hidden lg:block ${side === 'left' ? 'lg:order-2' : 'lg:order-4'} ${active ? 'is-active' : ''}`}
      onPointerDown={onDrag}
      onDoubleClick={onReset}
    />
  );
}

export function Workspace({ projectId, me }: { projectId: string; me: Me }) {
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLElement>(null);

  const reload = useCallback(() => api.get<ProjectPayload>(`/projects/${projectId}`).then(setData).catch((e) => setError(e.message)), [projectId]);
  useEffect(() => {
    reload();
    api.get<Catalog>('/catalog').then(setCatalog).catch((e) => setError(e.message));
  }, [reload]);

  if (error && !data)
    return (
      <div className="min-h-full">
        <TopBar me={me} />
        <div className="mx-auto max-w-lg p-8">
          <Notice tone="error">{error}</Notice>
        </div>
      </div>
    );
  if (!data || !catalog)
    return (
      <div className="min-h-full">
        <TopBar me={me} />
        <div className="flex items-center gap-2 p-8 text-muted">
          <Spinner /> Opening job
        </div>
      </div>
    );

  return <Loaded data={data} catalog={catalog} me={me} setData={setData} reload={reload} stageRef={stageRef} />;
}

function Loaded({ data, catalog, me, setData, reload, stageRef }: { data: ProjectPayload; catalog: Catalog; me: Me; setData: (d: ProjectPayload) => void; reload: () => Promise<void>; stageRef: React.RefObject<HTMLElement | null> }) {
  const p = data.project;
  const { desktop, widths, dragging, startDrag, reset } = useWorkspaceWidths(data);
  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <TopBar
        me={me}
        center={
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="font-mono text-[15px] font-medium text-navy">{p.jobNumber || 'No number'}</span>
              <span className="truncate font-medium">{p.name}</span>
            </div>
            <StepTracker data={data} />
          </div>
        }
      />
      {/* Below 1024 px the three sections stack; above it they sit side by side with drag handles. */}
      <div
        className={`workspace-grid grid flex-1 grid-cols-1 lg:min-h-0 ${dragging ? 'is-dragging' : ''}`}
        style={desktop ? { gridTemplateColumns: `${widths.left}px 7px minmax(0,1fr) 7px ${widths.right}px` } : undefined}
      >
        <aside className="order-2 min-w-0 border-r border-line bg-white lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          <OrderPanel data={data} catalog={catalog} onChange={setData} />
        </aside>
        <Handle side="left" onDrag={startDrag('left')} onReset={reset} active={dragging === 'left'} />
        <main ref={stageRef} className="stage order-1 min-w-0 lg:order-3 lg:min-h-0 lg:overflow-y-auto">
          <ConceptStage data={data} catalog={catalog} onChange={setData} reload={reload} />
        </main>
        <Handle side="right" onDrag={startDrag('right')} onReset={reset} active={dragging === 'right'} />
        <aside className="order-3 min-w-0 border-l border-line bg-white lg:order-5 lg:min-h-0 lg:overflow-y-auto">
          <OutputsPanel data={data} catalog={catalog} onChange={setData} />
        </aside>
      </div>
    </div>
  );
}
