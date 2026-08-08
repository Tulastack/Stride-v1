import Reveal from './Reveal'
import SectionHeading from './SectionHeading'

const CARDS = [
  {
    stat: '$200–500',
    unit: 'PER SESSION',
    title: 'Elite coaching is a luxury good',
    body: 'Private sprint coaching runs hundreds of dollars an hour. For almost every young runner, real form feedback is simply out of reach.',
  },
  {
    stat: '1 : 40+',
    unit: 'COACH TO ATHLETES',
    title: 'Team coaches are spread thin',
    body: 'School track rosters are huge. Most runners never get individual attention — so the same form errors persist season after season.',
  },
  {
    stat: 'SIDE-ON',
    unit: 'ONLY',
    title: 'Existing analyzers are lab tools',
    body: 'Current form analyzers demand perfect lighting, a fixed side-on camera, and controlled conditions. Real race footage almost never qualifies.',
  },
]

export default function Problem() {
  return (
    <section id="problem" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-36">
      <SectionHeading
        index="01"
        eyebrow="THE PROBLEM"
        title="Form errors persist because feedback is a luxury."
      />
      <div className="grid gap-5 md:grid-cols-3">
        {CARDS.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.1} className="h-full">
            <article className="group relative h-full overflow-hidden rounded-lg border border-hairline/70 bg-graphite-850 p-7 transition-colors duration-300 hover:border-bone-300/40">
              <p className="font-mono text-4xl tracking-tight text-flaw">{c.stat}</p>
              <p className="mt-1 font-mono text-[10px] tracking-[0.3em] text-muted">{c.unit}</p>
              <h3 className="mt-8 font-display text-xl font-semibold">{c.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-bone-300">{c.body}</p>
              <div className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-flaw/70 transition-transform duration-500 group-hover:scale-x-100" />
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
