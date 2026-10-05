import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'stage';

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary bg-navy text-white hover:bg-navy-700 disabled:bg-navy/40 disabled:shadow-none',
  secondary: 'btn-secondary bg-white text-ink border border-line hover:border-navy/50 hover:text-navy disabled:text-muted/60 disabled:shadow-none',
  ghost: 'text-graphite hover:bg-navy-50 hover:text-navy disabled:text-muted/60',
  danger: 'bg-white text-signal border border-signal/40 hover:bg-signal hover:text-white',
  stage: 'bg-white/10 text-white border border-white/15 hover:bg-white/20 hover:border-white/30 disabled:text-white/40',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: 'sm' | 'md' }>(
  function Button({ variant = 'primary', busy, size = 'md', className = '', children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={`inline-flex items-center justify-center gap-2 rounded-[3px] font-display font-semibold tracking-wide transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out disabled:cursor-not-allowed ${
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

/** The one text field look: hairline border, 3 px corners, navy when active. */
export const FIELD = 'rounded-[3px] border border-line bg-white px-3 text-ink outline-none focus:border-navy';

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

/** A numbered step marker: navy square, white mono digits. */
export function StepBadge({ step, tone = 'navy', className = '' }: { step: string; tone?: 'navy' | 'light'; className?: string }) {
  return (
    <span
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-[3px] font-mono text-[11.5px] font-medium leading-none ${
        tone === 'light' ? 'bg-white/10 text-bronze ring-1 ring-white/15' : 'bg-navy text-white'
      } ${className}`}
      aria-hidden
    >
      {step}
    </span>
  );
}

export function Panel({ title, step, action, children, className = '', busy }: { title: string; step?: string; action?: ReactNode; children: ReactNode; className?: string; busy?: boolean }) {
  return (
    <section className={`border-b border-line bg-panel ${className}`}>
      <header className="panel-head flex items-center justify-between gap-3 px-5 pt-4 pb-2.5">
        <h2 className="flex items-center gap-2.5 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-ink">
          {step && <StepBadge step={step} />}
          {title}
        </h2>
        {action}
      </header>
      {busy && <div className="progress mx-5" aria-hidden />}
      <div className="px-5 pb-6">{children}</div>
    </section>
  );
}

/** A white sheet with the brand's 3 px navy rule across the top. */
export function Card({ children, className = '', rule = true }: { children: ReactNode; className?: string; rule?: boolean }) {
  return <div className={`card ${rule ? 'card-rule' : ''} ${className}`}>{children}</div>;
}

const NOTICE_ICON = { info: Info, warn: AlertTriangle, error: XCircle, ok: CheckCircle2 };

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const t = {
    info: 'border-navy/25 bg-navy-50 text-navy-700',
    warn: 'border-amber/30 bg-amber-50 text-[#7a4a00]',
    error: 'border-signal/30 bg-signal/5 text-[#a8141a]',
    ok: 'border-ok/30 bg-ok-50 text-ok',
  }[tone];
  const Icon = NOTICE_ICON[tone];
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={`fade-in flex items-start gap-2 rounded-[3px] border px-3 py-2 text-[13px] leading-snug ${t}`}>
      <Icon className="mt-[1px] h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** An empty area that explains what will appear there, instead of a blank box. */
export function EmptyState({ icon, title, children, className = '' }: { icon?: ReactNode; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`rise grid place-items-center px-6 py-10 text-center ${className}`}>
      <div className="max-w-md">
        {icon && <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy">{icon}</div>}
        <div className="font-display text-[16px] font-semibold uppercase tracking-[0.06em] text-ink">{title}</div>
        {children && <div className="mt-1.5 text-[14px] leading-relaxed text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} aria-label="Working" />;
}

export const fmtIn = (v: number) => `${+v.toFixed(3)}″`;
export const fmtUsd = (v: number) => (v ? `$${v.toFixed(v < 1 ? 3 : 2)}` : '');
