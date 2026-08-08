const READOUTS = [
  ['KNEE DRIVE', '81.2°', 'flaw'],
  ['GROUND CONTACT', '0.104s', ''],
  ['HIP EXTENSION', '162.4°', ''],
  ['CADENCE', '4.61/s', ''],
  ['TRUNK LEAN', '8.9°', 'ok'],
  ['FLIGHT TIME', '0.132s', ''],
  ['ANKLE STIFFNESS', 'T2', ''],
  ['STRIDE LENGTH', '2.18m', 'ok'],
  ['SWING VELOCITY', '744°/s', ''],
  ['FORM SCORE', '82/100', 'ok'],
] as const

function Row() {
  return (
    <div className="flex shrink-0 items-center">
      {READOUTS.map(([label, value, tone]) => (
        <span
          key={label}
          className="flex items-center gap-3 px-8 font-mono text-xs tracking-[0.18em] whitespace-nowrap"
        >
          <span className="text-muted">{label}</span>
          <span
            className={
              tone === 'flaw' ? 'text-flaw' : tone === 'ok' ? 'text-improve' : 'text-bone-100'
            }
          >
            {value}
          </span>
          <span className="ml-5 text-hairline">//</span>
        </span>
      ))}
    </div>
  )
}

export default function Ticker() {
  return (
    <div className="relative overflow-hidden border-y border-hairline/60 bg-graphite-850 py-4">
      <div className="animate-marquee flex w-max">
        <Row />
        <Row />
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-graphite-900 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-graphite-900 to-transparent" />
    </div>
  )
}
