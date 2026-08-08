import Reveal from './Reveal'

export default function SectionHeading({
  index,
  eyebrow,
  title,
  lede,
}: {
  index: string
  eyebrow: string
  title: string
  lede?: string
}) {
  return (
    <div className="mb-14 max-w-3xl md:mb-20">
      <Reveal>
        <p className="mb-4 font-mono text-xs tracking-[0.25em] text-muted">
          <span className="text-volt">{index}</span> — {eyebrow}
        </p>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="font-display text-4xl font-bold tracking-tight text-balance md:text-5xl">
          {title}
        </h2>
      </Reveal>
      {lede && (
        <Reveal delay={0.16}>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-bone-300">{lede}</p>
        </Reveal>
      )}
    </div>
  )
}
