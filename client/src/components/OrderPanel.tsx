import { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, PenLine, Trash2, Upload } from 'lucide-react';
import { api, type ProjectPayload } from '../api';
import { assetUrl, SPEC_FIELDS, type Catalog } from '../catalog';
import { Button, Chip, Notice, Panel } from './ui';
import type { PlaqueSpec, WordingBlock, WordingRole } from '../../../shared/types';

type Props = { data: ProjectPayload; catalog: Catalog; onChange: (d: ProjectPayload) => void };

const SAMPLE_SPEC = `Plaque - Bronze\tBronze Plaque
12"w x 18"h
Satin finish with raised lettering and border
Recessed, paint-filled background (Dark Oxide or Leatherette)
relief image
Blind mounting`;

export function OrderPanel(props: Props) {
  return (
    <div>
      <SpecSection {...props} />
      <WordingSection {...props} />
      <FilesSection {...props} />
    </div>
  );
}

function SpecSection({ data, catalog, onChange }: Props) {
  const p = data.project;
  const [text, setText] = useState(p.specText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const assumed = new Set(p.parse?.assumed ?? []);

  const save = async (patch: Partial<PlaqueSpec>) => {
    setError('');
    try {
      onChange(await api.patch<ProjectPayload>(`/projects/${p.id}`, { spec: patch }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Panel step="01" title="Specification">
      <label className="block">
        <span className="label">Paste the order specification</span>
        <textarea
          className="mt-1 h-32 w-full resize-y rounded-[3px] border border-line px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-navy"
          placeholder={SAMPLE_SPEC}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          busy={busy}
          disabled={!text.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              onChange(await api.post<ProjectPayload>(`/projects/${p.id}/spec`, { specText: text }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Read specification
        </Button>
        {p.spec && text !== p.specText && <span className="text-[12px] text-amber">Text changed: read again to update</span>}
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      {p.spec && (
        <div className="mt-4">
          <div className="label mb-1 flex items-center justify-between">
            <span>What the app understood</span>
            {assumed.size > 0 && <Chip tone="amber">{assumed.size} assumed</Chip>}
          </div>
          <dl className="text-[14px]">
            <div className="flex items-end py-1.5">
              <dt className="text-graphite">Size</dt>
              <span className="leader" />
              <dd className="flex items-center gap-1 font-mono text-[13px]">
                <SizeInput value={p.spec.widthIn} onCommit={(v) => save({ widthIn: v })} label="Width in inches" />
                <span className="text-muted">w ×</span>
                <SizeInput value={p.spec.heightIn} onCommit={(v) => save({ heightIn: v })} label="Height in inches" />
                <span className="text-muted">h in</span>
              </dd>
            </div>
            {SPEC_FIELDS.map((f) => {
              const options = catalog.catalog[f.group];
              const value = p.spec![f.key];
              const opt = options.find((o) => o.id === value);
              return (
                <div key={f.key} className="flex items-center py-1.5">
                  <dt className="flex items-center gap-1.5 text-graphite">
                    {f.label}
                    {assumed.has(f.key) && <Chip tone="amber" title="Not stated in the order: the app picked this. Change it if needed.">Assumed</Chip>}
                  </dt>
                  <span className="leader" />
                  <dd className="flex items-center gap-2">
                    {opt?.asset && (f.group === 'finishes' || f.group === 'backgroundColors' || f.group === 'backgroundTextures') && (
                      <img src={assetUrl(opt.asset)} alt="" className="h-6 w-6 rounded-[2px] border border-line object-cover" />
                    )}
                    <select
                      aria-label={f.label}
                      className={`h-8 max-w-[190px] rounded-[3px] border bg-white px-1.5 text-[13px] outline-none focus:border-navy ${assumed.has(f.key) ? 'border-amber/50' : 'border-line'}`}
                      value={value}
                      onChange={(e) => save({ [f.key]: e.target.value } as Partial<PlaqueSpec>)}
                    >
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                          {o.upcharge ? ` (${o.upcharge})` : ''}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
              );
            })}
          </dl>
          {(p.parse?.notes ?? []).filter((n) => n.kind !== 'assumed').length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {p.parse!.notes
                .filter((n) => n.kind !== 'assumed')
                .map((n, i) => (
                  <li key={i}>
                    <Notice tone={n.kind === 'unavailable' || n.kind === 'conflict' ? 'warn' : 'info'}>{n.message}</Notice>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function SizeInput({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (n > 0 && n !== value) onCommit(n);
    else setV(String(value));
  };
  return (
    <input
      aria-label={label}
      className="h-8 w-14 rounded-[3px] border border-line px-1.5 text-right outline-none focus:border-navy"
      value={v}
      inputMode="decimal"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

const ROLES: { id: WordingRole; label: string }[] = [
  { id: 'headline', label: 'Headline' },
  { id: 'subhead', label: 'Subhead' },
  { id: 'body', label: 'Body' },
  { id: 'footer', label: 'Footer' },
];

function WordingSection({ data, onChange }: Props) {
  const p = data.project;
  const [text, setText] = useState(p.wordingText);
  const [blocks, setBlocks] = useState<WordingBlock[]>(p.wording?.blocks ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setBlocks(data.project.wording?.blocks ?? []), [data.project.wording]);
  useEffect(() => setText(data.project.wordingText), [data.project.wordingText]);
  const dirty = JSON.stringify(blocks) !== JSON.stringify(p.wording?.blocks ?? []);

  const run = async (fn: () => Promise<ProjectPayload>) => {
    setBusy(true);
    setError('');
    try {
      onChange(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      step="02"
      title="Customer wording"
      action={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run(() => api.upload<ProjectPayload>(`/projects/${p.id}/wording`, f));
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} busy={busy}>
            <FileText className="h-3.5 w-3.5" /> Word .docx
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="label">Or paste it exactly as the customer sent it</span>
        <textarea
          className="mt-1 h-24 w-full resize-y rounded-[3px] border border-line px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-navy"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Edwin J. Feulner Jr., Founder\nThe Heritage Foundation\nTo honor Ed\'s boundless optimism…'}
        />
      </label>
      <Button size="sm" className="mt-2" disabled={!text.trim() || text === p.wordingText} onClick={() => run(() => api.form<ProjectPayload>(`/projects/${p.id}/wording`, { text }))}>
        Use this wording
      </Button>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      {blocks.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="label">Lines on the plaque, top to bottom</div>
          {blocks.map((b, i) => (
            <div key={b.id} className="flex gap-2">
              <select
                aria-label="Line role"
                value={b.role}
                className="h-8 w-[92px] shrink-0 rounded-[3px] border border-line bg-white px-1 text-[12px] outline-none focus:border-navy"
                onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, role: e.target.value as WordingRole } : x)))}
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <textarea
                aria-label={`Line ${i + 1}`}
                value={b.text}
                rows={Math.min(5, Math.max(1, Math.ceil(b.text.length / 42)))}
                className={`w-full resize-none rounded-[3px] border border-line px-2 py-1 text-[13px] leading-snug outline-none focus:border-navy ${b.role === 'headline' ? 'font-semibold' : ''}`}
                onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              />
            </div>
          ))}
          {dirty && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run(() => api.patch<ProjectPayload>(`/projects/${p.id}`, { wording: { blocks } }))} busy={busy}>
                Save line changes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBlocks(p.wording?.blocks ?? [])}>
                Undo
              </Button>
            </div>
          )}
          <p className="text-[12px] text-muted">Text is reproduced character for character. Press Enter inside a line to force a line break.</p>
          {(p.wording?.notes ?? []).map((n, i) => (
            <Notice key={i} tone="info">
              {n}
            </Notice>
          ))}
        </div>
      )}
    </Panel>
  );
}

function FilesSection({ data, onChange }: Props) {
  const p = data.project;
  const ppi = data.layouts?.[0]?.photoPpi ?? null;
  return (
    <Panel step="03" title="Customer files">
      <div className="space-y-3">
        <UploadSlot
          kind="photo"
          label="Photo"
          hint="Portrait or picture for the plaque. JPG, PNG, TIFF."
          accept="image/*,.tif,.tiff"
          file={p.uploads.photo}
          data={data}
          onChange={onChange}
          extra={
            p.uploads.photo && (
              <span className={`font-mono text-[11px] ${ppi != null && ppi < 150 ? 'text-amber' : 'text-muted'}`}>
                {p.uploads.photo.width}×{p.uploads.photo.height}px{ppi != null && ` · ${ppi} ppi at size`}
              </span>
            )
          }
        />
        {ppi != null && ppi < 150 && (
          <Notice tone="warn">The photo is {ppi} pixels per inch at its size on the plaque. Fine for a concept; ask the customer for a larger original if fine detail matters.</Notice>
        )}
        <UploadSlot kind="logo" label="Logo" hint="SVG or PDF/AI preferred; PNG or JPG works." accept="image/*,.svg,.pdf,.ai,.eps" file={p.uploads.logo} data={data} onChange={onChange} />
        {p.uploads.logo && (
          <label className="flex items-center justify-between text-[13px]">
            <span className="text-graphite">Logo position</span>
            <select
              className="h-8 rounded-[3px] border border-line bg-white px-1.5 text-[13px] outline-none focus:border-navy"
              value={p.logoSlot}
              onChange={async (e) => onChange(await api.patch<ProjectPayload>(`/projects/${p.id}`, { logoSlot: e.target.value }))}
            >
              <option value="auto">Automatic</option>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        )}
        <UploadSlot kind="sketch" label="Sketch" hint="Customer's hand-drawn layout, if any. Image or PDF." accept="image/*,.pdf" file={p.uploads.sketch} data={data} onChange={onChange} />
      </div>
    </Panel>
  );
}

function UploadSlot({
  kind, label, hint, accept, file, data, onChange, extra,
}: {
  kind: 'photo' | 'logo' | 'sketch';
  label: string;
  hint: string;
  accept: string;
  file?: { file: string; name: string };
  data: ProjectPayload;
  onChange: (d: ProjectPayload) => void;
  extra?: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const p = data.project;
  const send = async (f: File) => {
    setBusy(true);
    setError('');
    try {
      onChange(await api.upload<ProjectPayload>(`/projects/${p.id}/upload/${kind}`, f));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const Icon = kind === 'sketch' ? PenLine : ImagePlus;
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) send(f);
        }}
        className={`flex items-center gap-3 rounded-[3px] border p-2 transition-colors ${drag ? 'border-navy bg-navy-50' : 'border-line'} ${file ? '' : 'border-dashed'}`}
      >
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[2px] bg-paper">
          {file ? <img src={`/api/projects/${p.id}/files/${kind}?f=${file.file}`} alt={label} className="h-full w-full object-contain" /> : <Icon className="h-5 w-5 text-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] font-semibold uppercase tracking-wide">{label}</div>
          <div className="truncate text-[12px] text-muted">{file ? file.name : hint}</div>
          {extra}
        </div>
        <input
          ref={ref}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) send(f);
            e.target.value = '';
          }}
        />
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant={file ? 'ghost' : 'secondary'} busy={busy} onClick={() => ref.current?.click()} aria-label={`Upload ${label}`}>
            <Upload className="h-3.5 w-3.5" />
            {file ? '' : 'Add'}
          </Button>
          {file && (
            <Button size="sm" variant="ghost" aria-label={`Remove ${label}`} onClick={async () => onChange(await api.del<ProjectPayload>(`/projects/${p.id}/upload/${kind}`))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {error && <div className="mt-1.5"><Notice tone="error">{error}</Notice></div>}
    </div>
  );
}
