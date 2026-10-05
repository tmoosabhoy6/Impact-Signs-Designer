import { useEffect, useState } from 'react';
import { ArrowRight, FileCheck2, FileCog, Images, ImageUp, ListOrdered, PenTool, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { navigate, type Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Card, EmptyState, FIELD, Notice, Spinner } from '../components/ui';
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

const STEPS = [
  { icon: ListOrdered, label: 'Order', text: 'Paste the specification and the customer wording. Upload photos, logos and sketches.' },
  { icon: Images, label: 'Concepts', text: 'Two production-realistic layouts. Ask for changes in plain words.' },
  { icon: FileCheck2, label: 'Proof', text: 'One customer proof PDF, up to three pages, on the real Impact Signs sheet.' },
  { icon: FileCog, label: 'Vector PDF', text: 'The one-ink production file that matches the chosen concept.' },
];

const TOOLS = [
  { href: '/upscaler', icon: ImageUp, label: 'AI Upscaler', text: 'Enlarge a small customer photo just enough to use.' },
  { href: '/vectorizer', icon: PenTool, label: 'Vectorizer', text: 'Turn a picture or PDF into a one-ink vector file.' },
];

/** When: "today 3:12 PM", "yesterday", or the date. Easier to scan than a full timestamp. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function Jobs({ me }: { me: Me }) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [jobNumber, setJobNumber] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [listError, setListError] = useState('');

  async function removeJob(j: JobRow) {
    const label = [j.jobNumber, j.name].filter(Boolean).join(' ') || 'this job';
    if (!window.confirm(`Delete ${label}? Its concepts, proofs and production files will be removed. This cannot be undone.`)) return;
    setDeleting(j.id);
    setListError('');
    try {
      await api.del(`/projects/${j.id}`);
      setJobs((cur) => (cur ?? []).filter((x) => x.id !== j.id));
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    api.get<{ projects: JobRow[] }>('/projects').then((d) => setJobs(d.projects)).catch((e) => setError(e.message));
  }, []);

  const filtered = (jobs ?? []).filter((j) => `${j.jobNumber} ${j.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="blueprint min-h-full">
      <TopBar me={me} />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-[340px_minmax(0,1fr)] md:px-6 md:py-10">
        <div className="min-w-0 space-y-5 md:sticky md:top-[76px] md:h-fit">
          <Card className="rise">
            <form
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
              <div className="space-y-4 p-5 sm:p-6">
                <div>
                  <h1 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">New plaque job</h1>
                  <p className="mt-0.5 text-[13.5px] text-muted">Opens the workspace for one plaque.</p>
                </div>
                <label className="block">
                  <span className="label">Job / project number</span>
                  <input className={`${FIELD} mt-1.5 h-10 w-full font-mono`} placeholder="Job number" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} required />
                </label>
                <label className="block">
                  <span className="label">Short name</span>
                  <input className={`${FIELD} mt-1.5 h-10 w-full`} placeholder="Customer or project name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                {error && <Notice tone="error">{error}</Notice>}
                <Button type="submit" busy={busy} className="w-full">
                  <Plus className="h-4 w-4" /> Start job
                </Button>
              </div>
            </form>
          </Card>

          <div className="rise" style={{ animationDelay: '90ms' }}>
            <div className="label mb-2 px-1">Tools</div>
            <ul className="stagger space-y-2">
              {TOOLS.map((t) => (
                <li key={t.href}>
                  <a
                    href={t.href}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(t.href);
                    }}
                    className="card group flex items-center gap-3 p-3 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-navy/40 hover:shadow-card-hover"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[3px] bg-navy-50 text-navy transition-colors group-hover:bg-navy group-hover:text-white">
                      <t.icon className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[14px] font-semibold uppercase tracking-[0.06em] text-ink">{t.label}</span>
                      <span className="block truncate text-[12.5px] text-muted">{t.text}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-navy" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <section className="min-w-0">
          <div className="rise mb-4 flex flex-wrap items-end justify-between gap-4" style={{ animationDelay: '60ms' }}>
            <div>
              <h2 className="flex items-baseline gap-2.5 font-display text-lg font-semibold uppercase tracking-[0.08em]">
                Your jobs
                {jobs && jobs.length > 0 && <span className="font-mono text-[13px] font-medium tracking-normal text-muted">{jobs.length}</span>}
              </h2>
              <p className="text-[14px] text-muted">Signed in as {me.user?.name}</p>
            </div>
            <label className="relative block w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input className={`${FIELD} h-10 w-full pl-9 text-[14px]`} placeholder="Search number or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
            </label>
          </div>
          {listError && (
            <div className="mb-3">
              <Notice tone="error">{listError}</Notice>
            </div>
          )}
          <Card rule={false} className="rise overflow-hidden" >
            {!jobs && (
              <div className="flex items-center gap-2 p-5 text-muted">
                <Spinner /> Loading jobs
              </div>
            )}
            {jobs && !filtered.length && (
              jobs.length ? (
                <EmptyState icon={<Search className="h-5 w-5" />} title="No jobs match">
                  Nothing is called “{q}”. Try the job number or part of the customer name.
                </EmptyState>
              ) : (
                <EmptyState icon={<Plus className="h-5 w-5" />} title="No jobs yet">
                  Start one with the form on the left. Each job walks through the four steps below.
                </EmptyState>
              )
            )}
            <ul className="stagger divide-y divide-line">
              {filtered.map((j) => (
                <li key={j.id} className="row-hover flex items-center hover:bg-navy-50/50">
                  <a
                    href={`/jobs/${j.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/jobs/${j.id}`);
                    }}
                    className="group flex min-w-0 flex-1 items-center gap-4 py-3 pl-5 pr-2"
                  >
                    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[3px] bg-stage shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                      {j.thumb ? (
                        <img src={`/api/concepts/${j.thumb}/preview.jpg`} alt="" className="h-full w-full object-contain p-1 transition-transform duration-300 group-hover:scale-[1.04]" />
                      ) : (
                        <div className="h-9 w-7 border border-bronze/60 shadow-[inset_0_0_0_2px_#1f2640]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-3">
                        <span className="shrink-0 font-mono text-[14px] font-medium text-navy">{j.jobNumber || 'No number'}</span>
                        <span className="truncate text-[15px] font-medium text-ink">{j.name}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                        {j.size && <span className="font-mono">{j.size}</span>}
                        {j.size && <span className="text-line">|</span>}
                        <span>{j.createdBy}</span>
                        <span className="text-line">|</span>
                        <span>updated {when(j.updatedAt)}</span>
                      </div>
                    </div>
                    <span className="hidden shrink-0 items-center gap-1.5 font-display text-[12px] font-semibold uppercase tracking-wider text-muted transition-colors group-hover:text-navy sm:inline-flex">
                      Open <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-navy sm:hidden" aria-hidden />
                  </a>
                  <button
                    type="button"
                    onClick={() => removeJob(j)}
                    disabled={deleting === j.id}
                    className="mr-3 grid h-9 w-9 shrink-0 place-items-center rounded-[3px] text-muted transition-colors hover:bg-white hover:text-signal hover:shadow-card disabled:opacity-50"
                    title="Delete job"
                    aria-label={`Delete job ${j.jobNumber || j.name}`}
                  >
                    {deleting === j.id ? <Spinner /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {jobs && jobs.length < 4 && (
            <div className="mt-8">
              <div className="label mb-3 px-1">How a job runs</div>
              <ol className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
                {STEPS.map((s, i) => (
                  <li key={s.label} className="card p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] bg-navy font-mono text-[12px] text-white">{String(i + 1).padStart(2, '0')}</span>
                      <s.icon className="h-4 w-4 shrink-0 text-navy" aria-hidden />
                      <span className="font-display text-[14px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap">{s.label}</span>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
