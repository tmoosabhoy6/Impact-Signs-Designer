import { useCallback, useEffect, useState } from 'react';
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
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-[3px] px-2 py-1 font-display text-[12px] font-semibold uppercase tracking-wider ${
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

export function Workspace({ projectId, me }: { projectId: string; me: Me }) {
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');

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

  const p = data.project;
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
      {/* Below 1400 px the side panels give up a little width so three concepts still fit across the stage. */}
      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[340px_minmax(0,1fr)_300px] wide:grid-cols-[380px_minmax(0,1fr)_340px]">
        <aside className="order-2 min-w-0 border-r border-line bg-white lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          <OrderPanel data={data} catalog={catalog} onChange={setData} />
        </aside>
        <main className="stage order-1 min-w-0 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
          <ConceptStage data={data} catalog={catalog} onChange={setData} reload={reload} />
        </main>
        <aside className="order-3 min-w-0 border-l border-line bg-white lg:min-h-0 lg:overflow-y-auto">
          <OutputsPanel data={data} catalog={catalog} onChange={setData} />
        </aside>
      </div>
    </div>
  );
}
