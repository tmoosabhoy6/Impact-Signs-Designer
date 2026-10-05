import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';

/**
 * Full-size viewer: the real image, zoomed with the wheel (or the buttons and keys) around the
 * cursor, moved by dragging, and reset with a double click. Esc closes it.
 */
export function Lightbox({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: window.innerWidth, h: window.innerHeight });
  // scale 1 = the image fitted to the window; tx/ty = how far its center has been dragged.
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = natural ? Math.min(box.w / natural.w, box.h / natural.h, 1e9) : 1;
  const fitW = natural ? natural.w * fit : 0;
  const fitH = natural ? natural.h * fit : 0;
  const pixelScale = view.scale * fit; // screen px per image px
  const MIN = 0.5;
  const MAX = Math.max(8, natural ? (natural.w / fitW) * 4 : 8);

  /** Zooms so the image point under (cx, cy), measured from the frame's center, stays put. */
  const zoomAt = useCallback((factor: number, cx = 0, cy = 0) => {
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  }, [MAX]);
  const reset = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), []);
  const actual = useCallback(() => setView((v) => ({ ...v, scale: fit ? 1 / fit : 1 })), [fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomAt(1.25);
      else if (e.key === '-') zoomAt(0.8);
      else if (e.key === '0') reset();
      else if (e.key === '1') actual();
      else if (e.key.startsWith('Arrow')) {
        const d = 60;
        setView((v) => ({ ...v, tx: v.tx + (e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0), ty: v.ty + (e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0) }));
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomAt, reset, actual]);

  // The wheel zooms the picture, never the page behind it.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2;
      const cy = e.clientY - r.top - r.height / 2;
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), cx, cy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  return (
    <div role="dialog" aria-modal aria-label={`${title} full size`} className="fade-in fixed inset-0 z-50 flex flex-col bg-[#101114] text-white">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4 backdrop-blur">
        <span className="min-w-0 truncate font-display text-[13px] font-semibold uppercase tracking-wider text-white/80">{title}</span>
        <span className="hidden text-[12px] text-white/45 sm:inline">Scroll to zoom · drag to move · double-click to fit</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="grid h-8 w-8 place-items-center rounded-[3px] text-white/80 transition-colors hover:bg-white/10 hover:text-white" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out (−)">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-14 text-center font-mono text-[12px] text-white/70" aria-live="polite">{Math.round(pixelScale * 100)}%</span>
          <button className="grid h-8 w-8 place-items-center rounded-[3px] text-white/80 transition-colors hover:bg-white/10 hover:text-white" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in (+)">
            <Plus className="h-4 w-4" />
          </button>
          <button className="ml-1 h-8 rounded-[3px] px-2 font-display text-[12px] font-semibold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10 hover:text-white" onClick={reset} title="Fit to window (0)">
            Fit
          </button>
          <button className="h-8 rounded-[3px] px-2 font-display text-[12px] font-semibold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10 hover:text-white" onClick={actual} title="Actual pixels (1)">
            100%
          </button>
          <button className="ml-2 grid h-8 w-8 place-items-center rounded-[3px] text-white/80 transition-colors hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close" title="Close (Esc)" autoFocus>
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        ref={frame}
        className={`relative min-h-0 flex-1 overflow-hidden select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = point(e);
          drag.current = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = point(e);
          const dx = p.x - drag.current.x;
          const dy = p.y - drag.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
          setView((v) => ({ ...v, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={(e) => {
          const p = point(e);
          if (view.scale > 1.01) reset();
          else zoomAt(2.5, p.x, p.y);
        }}
      >
        {natural && (
          <img
            src={src}
            alt={title}
            draggable={false}
            className="absolute top-1/2 left-1/2 max-w-none"
            style={{
              width: fitW,
              height: fitH,
              transform: `translate(calc(-50% + ${view.tx}px), calc(-50% + ${view.ty}px)) scale(${view.scale})`,
              transition: dragging ? 'none' : 'transform 120ms ease-out',
              imageRendering: pixelScale > 2.5 ? 'pixelated' : 'auto',
            }}
          />
        )}
        {!natural && (
          <img src={src} alt="" className="sr-only" onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        )}
        {!natural && (
          <div className="absolute inset-0 grid place-items-center text-white/60">
            <div className="flex items-center gap-2 text-[14px]"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden /> Loading the full-size image…</div>
          </div>
        )}
        {natural && <span className="pointer-events-none fade-in absolute bottom-3 left-3 rounded-[3px] border border-white/10 bg-black/50 px-2 py-0.5 font-mono text-[11px] text-white/70 backdrop-blur"><Maximize2 className="mr-1 inline h-3 w-3" />{natural.w} × {natural.h} px</span>}
      </div>
    </div>
  );
}
