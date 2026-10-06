import { useEffect, useState } from 'react';
import { api, ApiError, type ProjectPayload } from '../api';
import type { Catalog } from '../catalog';
import { Button, Notice } from './ui';
import type { ConceptRecord, OutputRecord } from '../../../shared/types';

export type OutputKind = 'proof' | 'production';
type WordingCheck = { message: string; differences: { expected: string; seen: string; where?: string }[]; issues: string[] };

/**
 * Makes the proof (one page per image on the proof, in order) or the vector PDF (from the first
 * image). `conceptIds` clears a stale warning when the images change.
 */
export function useMakeOutput(projectId: string, conceptIds: string[], onChange: (d: ProjectPayload) => void) {
  const conceptId = conceptIds[0] ?? null;
  const [busy, setBusy] = useState<OutputKind | null>(null);
  // An error stays under the button that caused it.
  const [error, setError] = useState<{ kind: OutputKind; message: string } | null>(null);
  const [check, setCheck] = useState<WordingCheck | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => { setCheck(null); setError(null); }, [conceptIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeProof = async (acknowledged = false) => {
    setBusy('proof');
    setError(null);
    try {
      onChange(await api.post<ProjectPayload>(`/projects/${projectId}/proof`, { conceptIds, acknowledged }));
      setCheck(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setCheck({ message: e.message, differences: (e.data.differences as WordingCheck['differences']) ?? [], issues: (e.data.issues as string[]) ?? [] });
      else setError({ kind: 'proof', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const makeProduction = async () => {
    setBusy('production');
    setError(null);
    try {
      const r = await api.post<ProjectPayload & { notes: string[] }>(`/projects/${projectId}/production`, conceptId ? { conceptId } : {});
      setNotes(r.notes);
      onChange(r);
    } catch (e) {
      setError({ kind: 'production', message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, check, notes, makeProof, makeProduction };
}

/** Wording/design checks found issues (or did not run): show them before proofing. */
export function WordingCheckWarning({ check, onConfirm }: { check: WordingCheck; onConfirm: () => void }) {
  return (
    <div className="space-y-2">
      <Notice tone="warn">
        <div className="font-semibold">{check.message}</div>
        {check.differences.map((d, i) => (
          <div key={i} className="font-mono text-[12px]">
            {d.where ? `${d.where}: ` : ''}expected “{d.expected}” · shows “{d.seen}”
          </div>
        ))}
        {check.issues.map((issue, i) => <div key={i}>{issue}</div>)}
        <div className="mt-1">Fix it on the concept first, or confirm you have checked it yourself.</div>
      </Notice>
      <Button size="sm" variant="danger" onClick={onConfirm}>
        I checked it: create proof anyway
      </Button>
    </div>
  );
}

/** "Feature Image v2": a concept's layout and version, numbered as the chips under its column. */
export function conceptTag(c: ConceptRecord, concepts: ConceptRecord[], catalog: Catalog): string {
  const label = catalog.presets.find((x) => x.id === c.preset)?.label ?? c.preset;
  const versions = concepts.filter((x) => x.preset === c.preset).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return `${label} v${versions.findIndex((x) => x.id === c.id) + 1}`;
}

/** The concept a file came from, as conceptTag; just the layout for older files. */
export function outputTag(o: OutputRecord, concepts: ConceptRecord[], catalog: Catalog): string {
  if (o.conceptIds && o.conceptIds.length > 1) {
    return o.conceptIds.map((id) => concepts.find((x) => x.id === id)).map((c, i) => (c ? conceptTag(c, concepts, catalog) : (catalog.presets.find((x) => x.id === o.presets?.[i])?.label ?? ''))).filter(Boolean).join(' + ');
  }
  const c = concepts.find((x) => x.id === o.conceptId);
  if (c) return conceptTag(c, concepts, catalog);
  return catalog.presets.find((x) => x.id === o.preset)?.label ?? '';
}
