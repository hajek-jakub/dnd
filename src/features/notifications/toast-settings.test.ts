import { describe, expect, it } from 'vitest'
import { setToastEnabled, toastEnabled } from './toast-settings'

describe('upozornění v aplikaci', () => {
  it('jsou výchozí zapnutá a vypínají se po kategoriích s uložením v prohlížeči', () => {
    expect(toastEnabled('rolls')).toBe(true)
    setToastEnabled('rolls', false)
    expect(toastEnabled('rolls')).toBe(false)
    expect(toastEnabled('messages')).toBe(true)
    expect(JSON.parse(localStorage.getItem('dnd.toasts') ?? '{}')).toEqual({ rolls: false })
  })
})
