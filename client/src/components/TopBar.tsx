import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, Settings2 } from 'lucide-react';
import { navigate, type Me } from '../App';
import { api } from '../api';

export function Logo({ className = 'h-6', light = false }: { className?: string; light?: boolean }) {
  return <span role="img" aria-label="Impact Signs" className={`brand-logo aspect-[1210/260] shrink-0 ${light ? 'brand-logo-light' : ''} ${className}`} />;
}

/** The tools next to the studio: each is its own page, independent of jobs. */
const TOOLS = [
  { href: '/upscaler', label: 'AI Upscaler' },
  { href: '/vectorizer', label: 'Vectorizer' },
  { href: '/merger', label: 'Proof Merger' },
];

/** True once the page has scrolled under the bar, which then casts a shadow. */
function useScrolled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(window.scrollY > 4);
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, []);
  return on;
}

export function TopBar({ me, center, right }: { me: Me; center?: ReactNode; right?: ReactNode }) {
  const path = window.location.pathname;
  const scrolled = useScrolled();
  const linkText = 'font-display text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors duration-150 sm:text-[14px] sm:tracking-[0.08em]';
  return (
    <header className={`topbar sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="flex h-14 items-center gap-4 px-4 md:px-5">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="group flex shrink-0 items-center gap-3"
          title="Your jobs"
        >
          <Logo />
          <span className="hidden h-5 w-px bg-line sm:block" />
          <span className="hidden font-display text-[15px] font-semibold uppercase tracking-[0.08em] text-ink transition-colors group-hover:text-navy sm:block">Plaque Proof Studio</span>
        </a>
        <nav className={`${center ? 'hidden sm:flex' : 'flex'} h-14 shrink-0 items-stretch gap-3 sm:gap-5`} aria-label="Tools">
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
                className={`nav-link flex items-center ${linkText} ${on ? 'text-navy' : 'text-graphite hover:text-navy'}`}
              >
                {t.label}
              </a>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{center}</div>
        <div className="flex shrink-0 items-center gap-1 text-[13px]">
          {right}
          {me.mock && (
            <span className="mr-2 hidden rounded-[3px] border border-amber/30 bg-amber-50 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-amber md:inline" title="MOCK_AI=1: images are simulated, no OpenAI calls">
              Demo mode
            </span>
          )}
          <a
            href="/admin"
            onClick={(e) => {
              e.preventDefault();
              navigate('/admin');
            }}
            aria-current={path.startsWith('/admin') ? 'page' : undefined}
            className={`hidden h-8 items-center gap-1.5 rounded-[3px] px-2 transition-colors hover:bg-navy-50 hover:text-navy sm:inline-flex ${path.startsWith('/admin') ? 'text-navy' : 'text-graphite'}`}
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden /> Admin
          </a>
          {me.passwordRequired && (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-[3px] px-2 text-graphite transition-colors hover:bg-navy-50 hover:text-navy"
              onClick={async () => {
                await api.post('/logout');
                window.location.href = '/';
              }}
              title={`Signed in as ${me.user?.name}`}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </div>
      <div className="h-[3px] bg-navy" />
    </header>
  );
}
