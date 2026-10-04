import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'stage';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-700 disabled:bg-navy/40',
  secondary: 'bg-white text-ink border border-line hover:border-navy/50 hover:text-navy disabled:text-muted/60',
  ghost: 'text-graphite hover:bg-navy-50 hover:text-navy disabled:text-muted/60',
  danger: 'bg-white text-signal border border-signal/40 hover:bg-signal hover:text-white',
  stage: 'bg-white/10 text-white border border-white/15 hover:bg-white/20 disabled:text-white/40',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: 'sm' | 'md' }>(
  function Button({ variant = 'primary', busy, size = 'md', className = '', children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={`inline-flex items-center justify-center gap-2 rounded-[3px] font-display font-semibold tracking-wide transition-colors duration-150 ease-out disabled:cursor-not-allowed ${
          size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-[15px]'
        } ${VARIANTS[variant]} ${className}`}
        {...rest}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function Chip({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'amber' | 'ok' | 'red' | 'navy'; children: ReactNode; title?: string }) {
  const t = {
    neutral: 'bg-paper text-graphite border-line',
    amber: 'bg-amber-50 text-amber border-amber/30',
    ok: 'bg-ok-50 text-ok border-ok/30',
    red: 'bg-signal/8 text-signal border-signal/30',
    navy: 'bg-navy-50 text-navy border-navy/20',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[1px] font-display text-[11px] font-semibold uppercase tracking-wider ${t}`}>
      {children}
    </span>
  );
}

export function Panel({ title, step, action, children, className = '' }: { title: string; step?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border-b border-line bg-panel ${className}`}>
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="flex items-baseline gap-2 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-ink">
          {step && <span className="font-mono text-[12px] font-medium text-navy">{step}</span>}
          {title}
        </h2>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const t = {
    info: 'border-navy/25 bg-navy-50 text-navy-700',
    warn: 'border-amber/30 bg-amber-50 text-[#7a4a00]',
    error: 'border-signal/30 bg-signal/5 text-[#a8141a]',
    ok: 'border-ok/30 bg-ok-50 text-ok',
  }[tone];
  return <div className={`rounded-[3px] border px-3 py-2 text-[13px] leading-snug ${t}`}>{children}</div>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} aria-label="Working" />;
}

export const fmtIn = (v: number) => `${+v.toFixed(3)}″`;
export const fmtUsd = (v: number) => (v ? `$${v.toFixed(v < 1 ? 3 : 2)}` : '');
