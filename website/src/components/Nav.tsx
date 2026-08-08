import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { lenis, scrollToId } from '../lib/scroll'

const LINKS = [
  { label: 'Problem', id: '#problem' },
  { label: 'Engine', id: '#engine' },
  { label: 'Report', id: '#report' },
  { label: 'Pricing', id: '#pricing' },
]

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled((lenis.scroll || window.scrollY) > 32)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    lenis.on('scroll', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      lenis.off('scroll', onScroll)
    }
  }, [])

  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
        scrolled ? 'border-b border-hairline/60 bg-graphite-900/95' : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            scrollToId('#top')
          }}
          className="flex items-center gap-2.5"
        >
          <img src="/stride-mark.png" alt="" className="h-6 w-auto" />
          <span className="font-display text-lg font-bold tracking-[0.14em]">STRIDE</span>
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.id}
              href={l.id}
              onClick={(e) => {
                e.preventDefault()
                scrollToId(l.id)
              }}
              className="font-mono text-xs tracking-[0.18em] text-bone-300 uppercase transition-colors hover:text-volt"
            >
              {l.label}
            </a>
          ))}
        </div>

        <button
          onClick={() => scrollToId('#waitlist')}
          className="rounded-[4px] bg-volt px-4 py-2 font-display text-sm font-semibold text-graphite-900 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
        >
          Join waitlist
        </button>
      </nav>
    </motion.header>
  )
}
