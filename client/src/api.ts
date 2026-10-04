import type { ConceptRecord, InstructionPlan, OutputRecord, PlaqueLayout, Project } from '../../shared/types';

export interface ProjectPayload {
  project: Project;
  concepts: ConceptRecord[];
  outputs: OutputRecord[];
  layouts: (PlaqueLayout & { photoPpi: number | null })[] | null;
  /** The DESCRIPTION header the Description-sheet proof writes from the spec. */
  autoDescription: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

export const api = {
  get: <T>(url: string) => fetch(`/api${url}`).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(`/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body: unknown) =>
    fetch(`/api${url}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  del: <T>(url: string) => fetch(`/api${url}`, { method: 'DELETE' }).then((r) => handle<T>(r)),
  upload: <T>(url: string, file: File, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fetch(`/api${url}`, { method: 'POST', body: fd }).then((r) => handle<T>(r));
  },
  form: <T>(url: string, fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fetch(`/api${url}`, { method: 'POST', body: fd }).then((r) => handle<T>(r));
  },
};

export type StreamEvent =
  | { type: 'plan'; plan: InstructionPlan }
  | { type: 'start'; concepts: ConceptRecord[] }
  | { type: 'concept'; concept: ConceptRecord }
  | { type: 'partial'; conceptId: string; image: string }
  | { type: 'end' };

/** POSTs and reads the Server-Sent Events stream of a generation. */
export async function stream(url: string, body: unknown, onEvent: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch(`/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok || !res.body) {
    await handle(res);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as StreamEvent);
    }
  }
}

export const conceptUrl = (c: { id: string }, file: 'image.png' | 'preview.jpg' | 'layout.png' | 'raw.png') => `/api/concepts/${c.id}/${file}`;
