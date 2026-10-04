import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api';
import type { Me } from '../App';
import { TopBar } from '../components/TopBar';
import { Button, Notice, Spinner } from '../components/ui';

interface AssetRow {
  group: string;
  groupLabel: string;
  id: string;
  label: string;
  expected: string;
  found: string | null;
}

const TABS = [
  { id: 'system', label: 'System' },
  { id: 'assets', label: 'Asset library' },
  { id: 'prompts', label: 'Image prompts' },
] as const;

export function Admin({ me }: { me: Me }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(() => (new URLSearchParams(location.search).get('tab') as 'system') || 'system');
  return (
    <div className="min-h-full">
      <TopBar me={me} />
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <h1 className="font-display text-lg font-semibold uppercase tracking-[0.08em]">Admin</h1>
        <nav className="mt-3 flex gap-1 border-b border-line" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 font-display text-[14px] font-semibold uppercase tracking-wide ${tab === t.id ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="mt-6">
          {tab === 'system' && <System />}
          {tab === 'assets' && <Assets />}
          {tab === 'prompts' && <Prompts />}
        </div>
      </main>
    </div>
  );
}

interface TestResult {
  ok: boolean;
  error?: string;
  image?: string;
  ms?: number;
  costUsd?: number;
  model?: string;
}

function System() {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const load = (live = false) => {
    setBusy(true);
    api
      .get<Record<string, unknown>>(`/health/details${live ? '?live=1' : ''}`)
      .then(setD)
      .finally(() => setBusy(false));
  };
  useEffect(() => load(), []);
  if (!d) return <Spinner />;
  const rows: [string, string][] = [
    ['Server', String(d.server)],
    ['Mode', String(d.mode)],
    ['OpenAI API key', String(d.openaiKey)],
    ['Image model', String(d.imageModel)],
    ['Spelling-check model', String(d.visionModel)],
    ['Default image quality', String(d.quality)],
    ['Prompt version', String(d.promptVersion)],
    ['Spent today', `$${d.spentTodayUsd} of $${d.dailyBudgetUsd} daily budget`],
    ['PDF tools', String(d.pdfTools)],
  ];
  if (d.modelCheck) rows.push(['Live model check', String(d.modelCheck)]);
  return (
    <div className="space-y-4">
      <dl className="border border-line bg-white">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 border-b border-line px-4 py-2.5 text-[14px] last:border-0">
            <dt className="w-48 shrink-0 text-muted">{k}</dt>
            <dd className="font-mono text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          busy={testing}
          onClick={async () => {
            setTesting(true);
            setTest(null);
            try {
              setTest(await api.post<TestResult>('/health/test-image'));
            } catch (e) {
              setTest({ ok: false, error: (e as Error).message });
            } finally {
              setTesting(false);
            }
          }}
        >
          Run a test image
        </Button>
        <Button variant="secondary" busy={busy} onClick={() => load(true)}>
          Check the OpenAI connection
        </Button>
      </div>
      <p className="text-[13px] text-muted">The test makes one small, low-quality image (about 2 cents) to prove the OpenAI setup works end to end. It takes up to a minute.</p>
      {testing && <Notice tone="info">Generating a test image… this can take up to a minute.</Notice>}
      {test && !test.ok && <Notice tone="error">{test.error}</Notice>}
      {test?.ok && (
        <div className="flex gap-4 border border-line bg-white p-3">
          <img src={test.image} alt="Test plaque" className="h-48 w-48 object-cover" />
          <div className="text-[14px]">
            <div className="font-semibold text-ok">OpenAI image generation works.</div>
            <div className="mt-1 font-mono text-[12.5px] text-muted">
              {test.model} · {((test.ms ?? 0) / 1000).toFixed(1)} s{test.costUsd ? ` · $${test.costUsd.toFixed(3)}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Assets() {
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  useEffect(() => {
    api.get<{ assets: AssetRow[] }>('/admin/assets').then((d) => setRows(d.assets));
  }, []);
  if (!rows) return <Spinner />;
  const missing = rows.filter((r) => !r.found).length;
  const groups = [...new Set(rows.map((r) => r.groupLabel))];
  return (
    <div className="space-y-6">
      <Notice tone={missing ? 'warn' : 'ok'}>
        {missing ? `${missing} of ${rows.length} icons are missing. Upload them to the assets/ folder on GitHub with the file names shown.` : `All ${rows.length} icons are in place.`} These files are pulled as-is onto proofs and sent to the image model as references; none are AI-generated.
      </Notice>
      {groups.map((g) => (
        <section key={g}>
          <h2 className="label mb-2">{g}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {rows
              .filter((r) => r.groupLabel === g)
              .map((r) => (
                <figure key={r.id} className="border border-line bg-white p-2">
                  <div className="grid aspect-square place-items-center overflow-hidden bg-paper">
                    {r.found ? <img src={`/library/${r.found}`} alt={r.label} className="h-full w-full object-cover" /> : <span className="text-[12px] text-signal">Missing</span>}
                  </div>
                  <figcaption className="mt-1.5 flex items-start gap-1 text-[12.5px] leading-tight">
                    {r.found ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-signal" />}
                    <span>
                      {r.label}
                      <span className="block font-mono text-[10.5px] break-all text-muted">{r.found ?? r.expected}</span>
                    </span>
                  </figcaption>
                </figure>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Prompts() {
  const [d, setD] = useState<{ version: string; files: { name: string; text: string }[] } | null>(null);
  useEffect(() => {
    api.get<typeof d>('/admin/prompts').then(setD);
  }, []);
  if (!d) return <Spinner />;
  return (
    <div className="space-y-5">
      <Notice tone="info">
        These instructions are sent with every image request (the image API has no saved “system prompt”, so each call carries them in full). They live in <span className="font-mono">server/prompts/</span> and can be edited there. Version <span className="font-mono">{d.version}</span> is recorded on every image.
      </Notice>
      {d.files.map((f) => (
        <section key={f.name}>
          <h2 className="label mb-1.5 font-mono normal-case">{f.name}</h2>
          <pre className="max-h-96 overflow-auto border border-line bg-white p-4 text-[12.5px] leading-relaxed whitespace-pre-wrap">{f.text}</pre>
        </section>
      ))}
    </div>
  );
}
