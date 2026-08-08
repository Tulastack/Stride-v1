import { scrollToId } from '../lib/scroll'

export default function Footer() {
  return (
    <footer className="border-t border-hairline/40">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 py-12 md:flex-row md:items-center md:px-8">
        <div className="flex items-center gap-2.5">
          <img src="/stride-mark.png" alt="Stride" className="h-5 w-auto" />
          <span className="font-display font-bold tracking-[0.14em]">STRIDE</span>
          <span className="ml-3 hidden font-mono text-[10px] tracking-[0.2em] text-muted sm:inline">
            BRIDGING RUNNING AND TECHNOLOGY
          </span>
        </div>

        <nav className="flex flex-wrap gap-6">
          {[
            ['Problem', '#problem'],
            ['Engine', '#engine'],
            ['Report', '#report'],
            ['Pricing', '#pricing'],
            ['Waitlist', '#waitlist'],
          ].map(([label, id]) => (
            <a
              key={id}
              href={id}
              onClick={(e) => {
                e.preventDefault()
                scrollToId(id)
              }}
              className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase transition-colors hover:text-bone-100"
            >
              {label}
            </a>
          ))}
        </nav>

        <p className="font-mono text-[11px] tracking-wide text-muted">
          © 2026 Stride ·{' '}
          <a
            href="mailto:adhibanarul@gmail.com"
            className="transition-colors hover:text-bone-100"
          >
            contact
          </a>
        </p>
      </div>
    </footer>
  )
}
