import { useEffect, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, FileCheck2, FileCog, AlertTriangle, XCircle } from 'lucide-react';
import { api, ApiError, conceptUrl, type ProjectPayload } from '../api';
import { assetUrl, type Catalog } from '../catalog';
import { Button, Notice, Panel } from './ui';
import { UploadSlot } from './OrderPanel';
import type { OutputRecord } from '../../../shared/types';

type Props = { data: ProjectPayload; catalog: Catalog; onChange: (d: ProjectPayload) => void };

export function OutputsPanel({ data, catalog, onChange }: Props) {
  const p = data.project;
  const selected = data.concepts.find((c) => c.id === p.selectedConceptId) ?? null;
  const proofs = data.outputs.filter((o) => o.kind === 'proof');
  const productions = data.outputs.filter((o) => o.kind === 'production');
  const [busy, setBusy] = useState<'proof' | 'production' | null>(null);
  // An error stays under the button that caused it.
  const [error, setError] = useState<{ kind: 'proof' | 'production' | null; message: string }>({ kind: null, message: '' });
  const [diffs, setDiffs] = useState<{ expected: string; seen: string }[] | null>(null);
  const [proofWarning, setProofWarning] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => { setDiffs(null); setProofWarning(''); }, [selected?.id]);

  const finish = p.spec && catalog.catalog.finishes.find((f) => f.id === p.spec!.finish);
  const paint = p.spec && catalog.catalog.backgroundColors.find((f) => f.id === p.spec!.backgroundColor);

  const makeProof = async (acknowledged = false) => {
    setBusy('proof');
    setError({ kind: null, message: '' });
    try {
      const r = await api.post<ProjectPayload>(`/projects/${p.id}/proof`, { conceptId: selected?.id, acknowledged });
      setDiffs(null);
      onChange(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setDiffs((e.data.differences as { expected: string; seen: string }[]) ?? []);
        setProofWarning(e.message);
      }
      else setError({ kind: 'proof', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const makeProduction = async () => {
    setBusy('production');
    setError({ kind: null, message: '' });
    try {
      const r = await api.post<ProjectPayload & { notes: string[] }>(`/projects/${p.id}/production`, { conceptId: selected?.id });
      setNotes(r.notes);
      onChange(r);
    } catch (e) {
      setError({ kind: 'production', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Panel step="05" title="Customer proof">
        {selected ? (
          <div className="flex gap-3">
            <img src={conceptUrl(selected, 'preview.jpg')} alt="Selected concept" className="h-24 w-auto max-w-[96px] bg-stage object-contain" />
            <div className="min-w-0 space-y-1.5 text-[13px]">
              <div className="label">Goes on the proof</div>
              {finish && (
                <div className="flex items-center gap-2">
                  {finish.asset && <img src={assetUrl(finish.asset)} alt="" className="h-7 w-7 border border-line object-cover" />}
                  <span>{finish.proofLabel ?? finish.label}</span>
                </div>
              )}
              {paint && (
                <div className="flex items-center gap-2">
                  {paint.asset ? <img src={assetUrl(paint.asset)} alt="" className="h-7 w-7 border border-line object-cover" /> : <span className="h-7 w-7 border border-line" style={{ background: paint.hex }} />}
                  <span>{paint.label} · Paint Fill</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Choose “Use this one” under a concept to put it on the proof.</p>
        )}
        <ProofSettings data={data} catalog={catalog} onChange={onChange} />
        <Button className="mt-3 w-full" disabled={!selected} busy={busy === 'proof'} onClick={() => makeProof(false)}>
          <FileCheck2 className="h-4 w-4" /> Create proof PDF
        </Button>
        {error.kind === 'proof' && <div className="mt-3"><Notice tone="error">{error.message}</Notice></div>}
        {diffs && (
          <div className="mt-3 space-y-2">
            <Notice tone="warn">
              <div className="font-semibold">{proofWarning}</div>
              {diffs.map((d, i) => (
                <div key={i} className="font-mono text-[12px]">
                  expected “{d.expected}” · shows “{d.seen}”
                </div>
              ))}
              <div className="mt-1">Fix it on the concept first, or confirm you have checked it yourself.</div>
            </Notice>
            <Button size="sm" variant="danger" onClick={() => makeProof(true)}>
              I checked it: create proof anyway
            </Button>
          </div>
        )}
        {proofs.length > 0 && (
          <ul className="mt-4 space-y-3">
            {proofs.map((o, i) => (
              <OutputItem key={o.id} o={o} latest={i === 0} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel step="06" title="Vector production PDF">
        <p className="text-[13px] text-muted">
          One-ink production file at full plaque size: black = raised metal, white = recessed field, all text outlined, photo area left as a placeholder. Built from the layout of the selected concept{selected ? ` (${catalog.presets.find((x) => x.id === selected.preset)?.label})` : ''}.
        </p>
        <Button className="mt-3 w-full" variant="secondary" disabled={!p.spec || !p.wording?.blocks.length} busy={busy === 'production'} onClick={makeProduction}>
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
        {productions.length > 0 && (
          <ul className="mt-4 space-y-3">
            {productions.map((o, i) => (
              <OutputItem key={o.id} o={o} latest={i === 0} />
            ))}
          </ul>
        )}
        {error.kind === 'production' && <div className="mt-3"><Notice tone="error">{error.message}</Notice></div>}
      </Panel>
    </div>
  );
}

function ProofSettings({ data, catalog, onChange }: Props) {
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
  const style = catalog.catalog.proofStyles.find((s) => s.id === p.proofStyle);
  const wallMount = !!p.spec && catalog.catalog.mountings.find((m) => m.id === p.spec!.mounting)?.scale !== 'ground';
  const sel = 'h-8 w-full rounded-[3px] border border-line bg-white px-1.5 text-[13px] outline-none focus:border-navy';
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-3">
      <label className="block">
        <span className="label">Proof style</span>
        <select className={`mt-1 ${sel}`} value={p.proofStyle} onChange={(e) => save({ proofStyle: e.target.value })}>
          {catalog.catalog.proofStyles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {style && <span className="mt-1 block text-[12px] leading-snug text-muted">{style.description}</span>}
      </label>

      {p.proofStyle === 'description' && (
        <>
          <label className="block">
            <span className="label">Scale panel</span>
            <select className={`mt-1 ${sel}`} value={p.visualScale} onChange={(e) => save({ visualScale: e.target.value })}>
              <option value="person">6 ft person {wallMount ? 'beside an 8 ft wall' : 'on the ground'}</option>
              <option value="site">Photo of the site (approximate)</option>
              <option value="none">None: option tiles along the bottom</option>
            </select>
          </label>
          {p.visualScale === 'site' && (
            <UploadSlot kind="site" label="Site photo" hint="Photo of the wall or spot where the plaque goes." accept="image/*" file={p.uploads.site} data={data} onChange={onChange} />
          )}
          {(p.visualScale === 'site' || (p.visualScale === 'person' && wallMount)) && (
            <label className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-graphite">{p.visualScale === 'site' ? 'Mounting height shown' : 'Plaque center height'}</span>
              <span className="flex items-center gap-1">
                <input
                  key={p.siteMountHeightIn ?? 'default'}
                  className="h-8 w-16 rounded-[3px] border border-line px-1.5 text-right font-mono outline-none focus:border-navy"
                  defaultValue={p.siteMountHeightIn ?? 60}
                  inputMode="decimal"
                  onBlur={(e) => save({ siteMountHeightIn: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
                  aria-label="Height in inches"
                />
                <span className="font-mono text-[12px] text-muted">in</span>
              </span>
            </label>
          )}
          <label className="block">
            <span className="label flex items-center justify-between">
              Description header
              {p.proofDescription && (
                <button className="text-[11px] normal-case tracking-normal text-navy hover:underline" onClick={() => save({ proofDescription: null })}>
                  Use automatic
                </button>
              )}
            </span>
            <textarea
              className="mt-1 h-28 w-full resize-y rounded-[3px] border border-line px-2 py-1 text-[12px] leading-snug outline-none focus:border-navy"
              value={desc || data.autoDescription || ''}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => desc && desc !== (p.proofDescription ?? '') && desc !== data.autoDescription && save({ proofDescription: desc })}
            />
            <span className="text-[11px] text-muted">{p.proofDescription ? 'Edited by hand.' : 'Written from the spec; edit to override.'}</span>
          </label>
        </>
      )}

      <label className="block">
        <span className="label">Red note under the plaque (optional)</span>
        <textarea
          className="mt-1 h-14 w-full resize-y rounded-[3px] border border-line px-2 py-1 text-[12px] leading-snug outline-none focus:border-navy"
          placeholder="Note: Small letters are currently at minimum required height (1/4’’)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (p.proofNote ?? '') && save({ proofNote: note || null })}
        />
      </label>
      {p.proofStyle === 'standard' && (
        <label className="block">
          <span className="label">Disclaimer</span>
          <select className={`mt-1 ${sel}`} value={p.disclaimer} onChange={(e) => save({ disclaimer: e.target.value })}>
            <option value="standard">Simulated appearance, actual product finish may vary…</option>
            <option value="photo">Photo for scale and placement only…</option>
          </select>
        </label>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function OutputItem({ o, latest }: { o: OutputRecord; latest: boolean }) {
  const [previewOk, setPreviewOk] = useState(true);
  const [open, setOpen] = useState(latest);
  return (
    <li className="border border-line">
      <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{o.fileName}</span>
          <span className="font-mono text-[11px] text-muted">{new Date(o.createdAt).toLocaleString()}</span>
        </span>
        {latest && <span className="shrink-0 font-display text-[11px] font-semibold uppercase tracking-wider text-navy">Latest</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          {previewOk && (
            <a href={`/api/outputs/${o.id}/download?inline=1`} target="_blank" rel="noreferrer" className="block bg-paper">
              <img src={`/api/outputs/${o.id}/preview.png`} alt={`${o.fileName} preview`} className="mx-auto max-h-72 object-contain" onError={() => setPreviewOk(false)} />
            </a>
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
            <a href={`/api/outputs/${o.id}/download`} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-navy px-3 font-display text-[13px] font-semibold tracking-wide text-white hover:bg-navy-700">
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <a href={`/api/outputs/${o.id}/download?inline=1`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[3px] border border-line px-3 font-display text-[13px] font-semibold tracking-wide text-ink hover:border-navy/50 hover:text-navy">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </div>
        </div>
      )}
    </li>
  );
}
