/** Web push on this device: ask, subscribe with the server's key, and hand the subscription over. */

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on'

export function pushState(): PushState {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  )
    return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return 'off'
}

/** iPhone and iPad only deliver web push to an app on the home screen. */
export function needsInstallForPush(): boolean {
  if (typeof navigator === 'undefined') return false
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  return ios && !standalone
}

function toKey(base64: string): ArrayBuffer {
  const padded = base64
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const raw = atob(padded)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return buffer
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushState() === 'unsupported') return null
  const registration = await navigator.serviceWorker.ready
  return await registration.pushManager.getSubscription()
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were not allowed on this device.')
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(publicKey),
    }))
  return subscription.toJSON()
}

export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await currentSubscription()
  if (!subscription) return null
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}
