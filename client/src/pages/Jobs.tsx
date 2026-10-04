import { useEffect, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { api } from '../api';
import { navigate, type Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Notice, Spinner } from '../components/ui';
import type { Project } from '../../../shared/types';

interface JobRow {
  id: string;
  jobNumber: string;
  name: string;
  updatedAt: string;
  createdBy: string;
  size: string;
  thumb: string | null;
}

interface Example {
  id: string;
  jobNumber: string;
  name: string;
  description: string;
}

function ExamplePicker() {
  const [examples, setExamples] = useState<Example[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<{ examples: Example[] }>('/examples').then((d) => setExamples(d.examples)).catch(() => {});
  }, []);
  if (!examples.length) return null;
  return (
    <div className="mt-6 border border-line bg-white">
      <div className="space-y-3 p-5">
        <div>
          <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.08em]">Start from an example</h2>
          <p className="text-[13px] text-muted">Real past orders with their spec, wording and photos already filled in. Good for demos.</p>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {examples.map((ex) => (
            <li key={ex.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px] text-navy">{ex.jobNumber}</span>
                  <span className="truncate text-[14px] font-medium">{ex.name}</span>
                </div>
                <div className="truncate text-[12px] text-muted">{ex.description}</div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                busy={busy === ex.id}
                disabled={!!busy}
                onClick={async () => {
                  setBusy(ex.id);
                  setError('');
                  try {
                    const { project } = await api.post<{ project: Project }>(`/examples/${ex.id}`);
                    navigate(`/jobs/${project.id}`);
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(null);
                  }
                }}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </div>
  );
}

export function Jobs({ me }: { me: Me }) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [jobNumber, setJobNumber] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get<{ projects: JobRow[] }>('/projects').then((d) => setJobs(d.projects)).catch((e) => setError(e.message));
  }, []);

  const filtered = (jobs ?? []).filter((j) => `${j.jobNumber} ${j.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-full">
      <TopBar me={me} />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-[340px_minmax(0,1fr)] md:px-6">
        <div className="h-fit min-w-0">
        <form
          className="border border-line bg-white"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const { project } = await api.post<{ project: Project }>('/projects', { jobNumber, name });
              navigate(`/jobs/${project.id}`);
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <div className="h-[3px] bg-navy" />
          <div className="space-y-4 p-5">
            <h1 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">New plaque job</h1>
            <label className="block">
              <span className="label">Job / project number</span>
              <input className="mt-1 h-10 w-full rounded-[3px] border border-line px-3 font-mono outline-none focus:border-navy" placeholder="32241" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} required />
            </label>
            <label className="block">
              <span className="label">Short name</span>
              <input className="mt-1 h-10 w-full rounded-[3px] border border-line px-3 outline-none focus:border-navy" placeholder="Heritage Foundation" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" busy={busy} className="w-full">
              <Plus className="h-4 w-4" /> Start job
            </Button>
          </div>
        </form>
        <ExamplePicker />
        </div>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">Jobs</h2>
              <p className="text-[14px] text-muted">Signed in as {me.user?.name}</p>
            </div>
            <input className="h-9 w-full rounded-[3px] border border-line bg-white px-3 text-[14px] outline-none focus:border-navy sm:w-56" placeholder="Search number or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
          </div>
          <div className="border border-line bg-white">
            {!jobs && (
              <div className="flex items-center gap-2 p-5 text-muted">
                <Spinner /> Loading jobs
              </div>
            )}
            {jobs && !filtered.length && (
              <div className="p-8 text-center text-[14px] text-muted">{jobs.length ? 'No jobs match that search.' : 'No jobs yet. Start one with the form on the left.'}</div>
            )}
            <ul className="divide-y divide-line">
              {filtered.map((j) => (
                <li key={j.id}>
                  <a
                    href={`/jobs/${j.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/jobs/${j.id}`);
                    }}
                    className="group flex items-center gap-4 px-4 py-3 hover:bg-navy-50/60"
                  >
                    <div className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden bg-stage">
                      {j.thumb ? <img src={`/api/concepts/${j.thumb}/preview.jpg`} alt="" className="h-full w-full object-contain" /> : <div className="h-8 w-6 border border-bronze/50" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-[14px] font-medium text-navy">{j.jobNumber || 'No number'}</span>
                        <span className="truncate font-medium">{j.name}</span>
                      </div>
                      <div className="text-[13px] text-muted">
                        {j.size && <span className="font-mono">{j.size}</span>} {j.size && '· '}
                        {j.createdBy} · updated {new Date(j.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-navy" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
