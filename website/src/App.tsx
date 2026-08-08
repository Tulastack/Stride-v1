import { useEffect } from 'react'
import { lenis } from './lib/scroll'
import Nav from './components/Nav'
import Hero from './components/Hero'
import Ticker from './components/Ticker'
import Problem from './components/Problem'
import Pipeline from './components/Pipeline'
import Metrics from './components/Metrics'
import Compare from './components/Compare'
import Pricing from './components/Pricing'
import Waitlist from './components/Waitlist'
import Footer from './components/Footer'

export default function App() {
  useEffect(() => {
    // Lenis is a module singleton with autoRaf; nothing to start, but make sure
    // it's not left in a stopped state after HMR.
    lenis.start()
  }, [])

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Ticker />
        <Problem />
        <Pipeline />
        <Metrics />
        <Compare />
        <Pricing />
        <Waitlist />
      </main>
      <Footer />

      {/* Film grain — kills the flat gradient look without touching surfaces */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </>
  )
}
