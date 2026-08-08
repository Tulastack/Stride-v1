import Lenis from 'lenis'

export const lenis = new Lenis({ autoRaf: true, lerp: 0.115 })

export function scrollToId(id: string) {
  lenis.scrollTo(id, { offset: -64, duration: 1.4 })
}
