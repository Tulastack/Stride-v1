import Reveal from './Reveal'
import SectionHeading from './SectionHeading'

const ROWS: [string, boolean, string, string, string][] = [
  ['Sprint-specific biometrics', true, '✓', '✕', '✓'],
  ['Any-angle phone video', true, '✕', '✕', '—'],
  ['3D gravity alignment', true, '✕', '✕', '✕'],
  ['Under $5 / month', true, '✕', '✕', '✕'],
  ['Coach, plans & calendar', true, '✕', '✕', '✓'],
]

const COLS = ['Lab motion capture', 'Form-check apps', 'Private coaching']

export default function Compare() {
  return (
    <section className="border-y border-hairline/40 bg-graphite-850/40">
      <div className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-36">
        <SectionHeading
          index="04"
          eyebrow="WHY STRIDE"
          title="The only place all five live together."
        />
        <Reveal>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-hairline/60">
                  <th className="py-4 pr-4 text-left font-mono text-[10px] font-normal tracking-[0.25em] text-muted">
                    CAPABILITY
                  </th>
                  <th className="px-4 py-4 text-center">
                    <span className="inline-block rounded-[4px] bg-volt px-3 py-1 font-display text-sm font-bold text-graphite-900">
                      STRIDE
                    </span>
                  </th>
                  {COLS.map((c) => (
                    <th
                      key={c}
                      className="px-4 py-4 text-center font-mono text-[10px] font-normal tracking-[0.18em] text-muted uppercase"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([cap, , a, b, c]) => (
                  <tr
                    key={cap}
                    className="border-b border-hairline/30 transition-colors hover:bg-graphite-800/50"
                  >
                    <td className="py-4 pr-4 text-sm text-bone-100">{cap}</td>
                    <td className="px-4 py-4 text-center font-mono text-volt">✓</td>
                    {[a, b, c].map((v, i) => (
                      <td
                        key={i}
                        className={`px-4 py-4 text-center font-mono ${
                          v === '✓' ? 'text-bone-300' : 'text-muted/60'
                        }`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 font-mono text-xs tracking-wide text-muted">
            * Private coaching does it well — at $200–500 per session.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
