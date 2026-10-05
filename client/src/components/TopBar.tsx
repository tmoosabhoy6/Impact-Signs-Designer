import type { ReactNode } from 'react';
import { navigate, type Me } from '../App';
import { api } from '../api';

export function Logo({ className = 'h-6' }: { className?: string }) {
  return <span role="img" aria-label="Impact Signs" className={`brand-logo aspect-[1210/260] shrink-0 ${className}`} />;
}

/** The tools next to the studio: each is its own page, independent of jobs. */
const TOOLS = [
  { href: '/upscaler', label: 'AI Upscaler' },
  { href: '/vectorizer', label: 'Vectorizer' },
];

export function TopBar({ me, center, right }: { me: Me; center?: ReactNode; right?: ReactNode }) {
  const path = window.location.pathname;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white">
      <div className="flex h-14 items-center gap-4 px-4 md:px-5">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="flex shrink-0 items-center gap-3"
        >
          <Logo />
          <span className="hidden h-5 w-px bg-line sm:block" />
          <span className="hidden font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-ink sm:block">Plaque Proof Studio</span>
        </a>
        <nav className={`${center ? 'hidden sm:flex' : 'flex'} h-14 shrink-0 items-stretch gap-2 sm:gap-3`} aria-label="Tools">
          {TOOLS.map((t) => {
            const on = path.startsWith(t.href);
            return (
              <a
                key={t.href}
                href={t.href}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(t.href);
                }}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center border-b-[3px] px-1 font-display text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors duration-150 sm:text-[14px] sm:tracking-[0.08em] ${
                  on ? 'border-gold text-navy' : 'border-transparent text-graphite hover:border-line hover:text-accent'
                }`}
              >
                {t.label}
              </a>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{center}</div>
        <div className="flex shrink-0 items-center gap-3 text-[13px]">
          {right}
          {me.mock && (
            <span className="hidden rounded-[3px] border border-amber/30 bg-amber-50 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-amber md:inline" title="MOCK_AI=1: images are simulated, no OpenAI calls">
              Demo mode
            </span>
          )}
          <a
            href="/admin"
            onClick={(e) => {
              e.preventDefault();
              navigate('/admin');
            }}
            className="hidden text-graphite transition-colors hover:text-accent sm:inline"
          >
            Admin
          </a>
          {me.passwordRequired && (
            <button
              className="text-graphite transition-colors hover:text-accent"
              onClick={async () => {
                await api.post('/logout');
                window.location.href = '/';
              }}
              title={`Signed in as ${me.user?.name}`}
            >
              Sign out
            </button>
          )}
        </div>
      </div>
      <div className="h-[3px] bg-navy" />
    </header>
  );
}
