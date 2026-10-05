import { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, PenLine, Trash2, Type, Upload } from 'lucide-react';
import { api, type ProjectPayload } from '../api';
import { assetUrl, SPEC_FIELDS, type Catalog, type CatalogOption } from '../catalog';
import { Button, Chip, Notice, Panel } from './ui';
import type { PlaqueSpec, TextStyle, WordingBlock, WordingRole } from '../../../shared/types';

type Props = { data: ProjectPayload; catalog: Catalog; onChange: (d: ProjectPayload) => void };

const SAMPLE_SPEC = `Plaque - Bronze\tBronze Plaque
12"w x 18"h
Satin finish with raised lettering and border
Recessed, paint-filled background (Dark Oxide or Leatherette)
relief image
Blind mounting`;

export { UploadSlot };

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
              const options = (catalog.catalog[f.group] as CatalogOption[]).filter(
                (o) => f.group !== 'finishes' || (o.materials ?? ['bronze']).includes(p.spec!.material),
              );
              const value = p.spec![f.key] as string;
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
                      onChange={(e) => {
                        const patch = { [f.key]: e.target.value } as Partial<PlaqueSpec>;
                        // Switching material also switches to a finish made for it.
                        if (f.key === 'material') {
                          const fin = catalog.catalog.finishes.find((o) => (o.materials ?? ['bronze']).includes(e.target.value));
                          if (fin) patch.finish = fin.id;
                        }
                        save(patch);
                      }}
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
            {p.spec.backgroundColor === 'custom' && (
              <Row label="Custom paint">
                <TextInput label="Custom paint name" value={p.spec.customPaint?.name ?? ''} placeholder="Dark Blue 2050" onCommit={(v) => save({ customPaint: { name: v, hex: p.spec!.customPaint?.hex ?? '#1D2B5E' } })} />
                <input
                  type="color"
                  aria-label="Custom paint color"
                  className="h-8 w-9 cursor-pointer rounded-[3px] border border-line bg-white p-0.5"
                  value={p.spec.customPaint?.hex ?? '#1D2B5E'}
                  onChange={(e) => save({ customPaint: { name: p.spec!.customPaint?.name ?? 'Custom color', hex: e.target.value } })}
                />
              </Row>
            )}
            {p.spec.font === 'custom' && (
              <Row label="Custom font">
                <TextInput label="Custom font name" value={p.spec.customFontName ?? ''} placeholder="Clarendon Fortune Bold" onCommit={(v) => save({ customFontName: v })} />
              </Row>
            )}
            {p.spec.mounting === 'garden-stake' && (
              <Row label="Stake length">
                <SizeInput label="Garden stake length in inches" value={p.spec.stakeLengthIn ?? 24} onCommit={(v) => save({ stakeLengthIn: v })} />
                <span className="font-mono text-[12px] text-muted">in</span>
              </Row>
            )}
            <Row label="Thickness (optional)">
              <TextInput
                label="Plate thickness in inches"
                value={p.spec.thicknessIn ? String(p.spec.thicknessIn) : ''}
                placeholder="0.25"
                width="w-16"
                onCommit={(v) => save({ thicknessIn: v ? Number(v) || null : null })}
              />
              <span className="font-mono text-[12px] text-muted">in</span>
            </Row>
          </dl>
          {p.spec.font === 'custom' && (
            <div className="mt-2">
              <UploadSlot
                kind="font"
                label="Font file"
                hint="The customer's font (.otf / .ttf / .woff), used for the vector file and the layout."
                accept=".otf,.ttf,.woff"
                file={p.uploads.font}
                data={data}
                onChange={onChange}
                noPreview
              />
            </div>
          )}
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center py-1.5">
      <dt className="text-graphite">{label}</dt>
      <span className="leader" />
      <dd className="flex items-center gap-1.5">{children}</dd>
    </div>
  );
}

function TextInput({ value, onCommit, label, placeholder, width = 'w-40' }: { value: string; onCommit: (v: string) => void; label: string; placeholder?: string; width?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
  };
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      className={`h-8 ${width} rounded-[3px] border border-line px-2 text-[13px] outline-none focus:border-navy`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
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

/** Where the photo sits among the lines; arrows move it up or down. */
function ImageMarker({ index, count, onMove }: { index: number; count: number; onMove: (to: number | null) => void }) {
  return (
    <div className="my-1 flex items-center gap-2 rounded-[3px] border border-dashed border-bronze bg-bronze/10 px-2 py-1 text-[12px] text-[#7a5a32]">
      <ImagePlus className="h-3.5 w-3.5" />
      <span className="flex-1">Photo goes here</span>
      <button className="rounded px-1.5 hover:bg-bronze/20 disabled:opacity-30" disabled={index < 0} onClick={() => onMove(index - 1 < 0 ? null : index - 1)} aria-label="Move the photo up">
        ↑
      </button>
      <button className="rounded px-1.5 hover:bg-bronze/20 disabled:opacity-30" disabled={index >= count - 1} onClick={() => onMove(index + 1)} aria-label="Move the photo down">
        ↓
      </button>
    </div>
  );
}

/** Per-line type controls: italic, bold, small caps, size, font, columns, rule. */
function StyleBar({ style, catalog, onChange }: { style: TextStyle; catalog: Catalog; onChange: (s: TextStyle) => void }) {
  const toggle = (k: 'italic' | 'bold' | 'smallCaps' | 'ruleBelow') => onChange({ ...style, [k]: !style[k] || undefined });
  const btn = (on: boolean) =>
    `h-6 min-w-6 rounded-[3px] border px-1.5 text-[11px] ${on ? 'border-navy bg-navy text-white' : 'border-line bg-white text-graphite hover:border-navy/50'}`;
  const size = style.size ?? 1;
  return (
    <div className="mt-1 mb-2 ml-[100px] flex flex-wrap items-center gap-1">
      <button className={`${btn(!!style.italic)} italic`} onClick={() => toggle('italic')} title="Italic" aria-pressed={!!style.italic}>
        I
      </button>
      <button className={`${btn(!!style.bold)} font-bold`} onClick={() => toggle('bold')} title="Bold" aria-pressed={!!style.bold}>
        B
      </button>
      <button className={btn(!!style.smallCaps)} style={{ fontVariant: 'small-caps' }} onClick={() => toggle('smallCaps')} title="Small capitals" aria-pressed={!!style.smallCaps}>
        Sc
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button className={btn(false)} onClick={() => onChange({ ...style, size: Math.max(0.5, +(size - 0.1).toFixed(2)) })} title="Smaller" aria-label="Smaller">
        A−
      </button>
      <span className="w-9 text-center font-mono text-[11px] text-muted">{Math.round(size * 100)}%</span>
      <button className={btn(false)} onClick={() => onChange({ ...style, size: Math.min(2.5, +(size + 0.1).toFixed(2)) })} title="Larger" aria-label="Larger">
        A+
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <select
        aria-label="Columns"
        className="h-6 rounded-[3px] border border-line bg-white px-1 text-[11px]"
        value={style.columns ?? 1}
        onChange={(e) => onChange({ ...style, columns: Number(e.target.value) > 1 ? Number(e.target.value) : undefined, align: Number(e.target.value) > 1 ? style.align ?? 'left' : style.align })}
        title="Set this block's lines in columns (donor lists)"
      >
        {[1, 2, 3, 4].map((n) => (
          <option key={n} value={n}>
            {n === 1 ? '1 column' : `${n} columns`}
          </option>
        ))}
      </select>
      <button className={btn(!!style.ruleBelow)} onClick={() => toggle('ruleBelow')} title="Raised line under this heading" aria-pressed={!!style.ruleBelow}>
        ― rule
      </button>
      <select
        aria-label="Font for this line"
        className="h-6 max-w-[110px] rounded-[3px] border border-line bg-white px-1 text-[11px]"
        value={style.font ?? ''}
        onChange={(e) => onChange({ ...style, font: e.target.value || undefined })}
        title="Font for this line only"
      >
        <option value="">Plaque font</option>
        {catalog.catalog.fonts.filter((f) => f.id !== 'custom').map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const ROLES: { id: WordingRole; label: string }[] = [
  { id: 'headline', label: 'Headline' },
  { id: 'subhead', label: 'Subhead' },
  { id: 'body', label: 'Body' },
  { id: 'footer', label: 'Footer' },
];

function WordingSection({ data, catalog, onChange }: Props) {
  const p = data.project;
  const hasImage = !!p.spec && p.spec.imageOption !== 'none';
  const setImageAfter = async (to: number | null) => onChange(await api.patch<ProjectPayload>(`/projects/${p.id}`, { imageAfterBlock: to }));
  const [text, setText] = useState(p.wordingText);
  const [blocks, setBlocks] = useState<WordingBlock[]>(p.wording?.blocks ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Every save from any panel returns a fresh project object. Only a real change to the saved
  // lines resets the editor, so edits in progress survive e.g. uploading a photo.
  const savedBlocks = JSON.stringify(p.wording?.blocks ?? []);
  useEffect(() => setBlocks(JSON.parse(savedBlocks)), [savedBlocks]);
  useEffect(() => setText(data.project.wordingText), [data.project.wordingText]);
  const dirty = JSON.stringify(blocks) !== savedBlocks;

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
          {hasImage && p.imageAfterBlock == null && <ImageMarker onMove={(to) => setImageAfter(to)} index={-1} count={blocks.length} />}
          {blocks.map((b, i) => (
            <div key={b.id}>
              <div className="flex gap-2">
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
                  rows={Math.min(6, Math.max(1, b.text.split('\n').length, Math.ceil(b.text.length / 42)))}
                  className={`w-full resize-none rounded-[3px] border border-line px-2 py-1 text-[13px] leading-snug outline-none focus:border-navy ${b.style?.bold || b.role === 'headline' ? 'font-semibold' : ''} ${b.style?.italic ? 'italic' : ''}`}
                  style={b.style?.smallCaps ? { fontVariant: 'small-caps' } : undefined}
                  onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
              </div>
              <StyleBar
                style={b.style ?? {}}
                catalog={catalog}
                onChange={(style) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, style } : x)))}
              />
              {hasImage && p.imageAfterBlock === i && <ImageMarker onMove={(to) => setImageAfter(to)} index={i} count={blocks.length} />}
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
  kind, label, hint, accept, file, data, onChange, extra, noPreview,
}: {
  kind: 'photo' | 'logo' | 'sketch' | 'site' | 'font';
  noPreview?: boolean;
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
  const Icon = kind === 'sketch' ? PenLine : kind === 'font' ? Type : ImagePlus;
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
          {file && !noPreview ? <img src={`/api/projects/${p.id}/files/${kind}?f=${file.file}`} alt={label} className="h-full w-full object-contain" /> : <Icon className="h-5 w-5 text-muted" />}
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
