import { useEffect, useState } from 'react';
import { api, ApiError, type ProjectPayload } from '../api';
import type { Catalog } from '../catalog';
import { Button, Notice } from './ui';
import type { ConceptRecord, OutputRecord } from '../../../shared/types';

export type OutputKind = 'proof' | 'production';
type WordingCheck = { message: string; differences: { expected: string; seen: string }[] };

/**
 * Makes a proof or vector PDF from one concept. Both the right-hand panel (selected concept)
 * and every concept column (the version it shows) use this, so the wording check works the same.
 * `conceptId` clears a stale warning when the concept changes.
 */
export function useMakeOutput(projectId: string, conceptId: string | null, onChange: (d: ProjectPayload) => void) {
  const [busy, setBusy] = useState<OutputKind | null>(null);
  // An error stays under the button that caused it.
  const [error, setError] = useState<{ kind: OutputKind; message: string } | null>(null);
  const [check, setCheck] = useState<WordingCheck | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => { setCheck(null); setError(null); }, [conceptId]);

  const makeProof = async (acknowledged = false) => {
    setBusy('proof');
    setError(null);
    try {
      onChange(await api.post<ProjectPayload>(`/projects/${projectId}/proof`, { conceptId, acknowledged }));
      setCheck(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setCheck({ message: e.message, differences: (e.data.differences as WordingCheck['differences']) ?? [] });
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

/** The spelling check found differences (or did not run): show them and ask before proofing. */
export function WordingCheckWarning({ check, onConfirm }: { check: WordingCheck; onConfirm: () => void }) {
  return (
    <div className="space-y-2">
      <Notice tone="warn">
        <div className="font-semibold">{check.message}</div>
        {check.differences.map((d, i) => (
          <div key={i} className="font-mono text-[12px]">
            expected “{d.expected}” · shows “{d.seen}”
          </div>
        ))}
        <div className="mt-1">Fix it on the concept first, or confirm you have checked it yourself.</div>
      </Notice>
      <Button size="sm" variant="danger" onClick={onConfirm}>
        I checked it: create proof anyway
      </Button>
    </div>
  );
}

/** "Feature Image v2": the concept a file came from, numbered as the chips under that column. */
export function outputTag(o: OutputRecord, concepts: ConceptRecord[], catalog: Catalog): string {
  const c = concepts.find((x) => x.id === o.conceptId);
  const preset = o.preset ?? c?.preset;
  const label = catalog.presets.find((x) => x.id === preset)?.label ?? '';
  if (!c) return label;
  const versions = concepts.filter((x) => x.preset === c.preset).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return `${label} v${versions.findIndex((x) => x.id === c.id) + 1}`;
}
