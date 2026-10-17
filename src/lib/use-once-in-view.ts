import { useEffect, useRef, useState } from 'react'

/**
 * "done" is the default, so content renders finished without JavaScript. Elements still below
 * the fold on load wait, then play their one change when they scroll into view. Reduced motion
 * keeps everything finished.
 */
export function useOnceInView<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [state, setState] = useState<'waiting' | 'done'>('done')

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (element.getBoundingClientRect().top < window.innerHeight) return
    setState('waiting')
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setState('done')
        observer.disconnect()
      },
      { rootMargin: '0px 0px -30% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, state] as const
}
