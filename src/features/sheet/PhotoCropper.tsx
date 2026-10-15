import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const PREVIEW = 280
const OUTPUT = 512

/** Ořez fotky na čtverec: posun tažením, přiblížení posuvníkem. Výsledek je JPEG 512x512 (malý a rychlý na nahrání). */
export function PhotoCropper({
  file,
  onCancel,
  onDone,
  pending,
}: {
  file: File
  onCancel: () => void
  onDone: (blob: Blob) => void
  pending: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  // Střed výřezu v souřadnicích obrázku
  const [center, setCenter] = useState({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setImage(img)
      setCenter({ x: img.naturalWidth / 2, y: img.naturalHeight / 2 })
      setZoom(1)
    }
    img.onerror = () => setError('Tenhle soubor nejde otevřít jako obrázek.')
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  /** Velikost výřezu v pixelech obrázku při daném přiblížení. */
  const cropSize = useCallback((img: HTMLImageElement, z: number) => Math.min(img.naturalWidth, img.naturalHeight) / z, [])

  const clampCenter = useCallback(
    (img: HTMLImageElement, c: { x: number; y: number }, z: number) => {
      const half = cropSize(img, z) / 2
      return { x: Math.max(half, Math.min(img.naturalWidth - half, c.x)), y: Math.max(half, Math.min(img.naturalHeight - half, c.y)) }
    },
    [cropSize],
  )

  useEffect(() => {
    if (!image || !canvas.current) return
    const ctx = canvas.current.getContext('2d')
    if (!ctx) return
    const size = cropSize(image, zoom)
    const c = clampCenter(image, center, zoom)
    ctx.clearRect(0, 0, PREVIEW, PREVIEW)
    ctx.drawImage(image, c.x - size / 2, c.y - size / 2, size, size, 0, 0, PREVIEW, PREVIEW)
  }, [image, zoom, center, cropSize, clampCenter])

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !image) return
    const scale = cropSize(image, zoom) / PREVIEW
    const dx = (e.clientX - drag.current.x) * scale
    const dy = (e.clientY - drag.current.y) * scale
    drag.current = { x: e.clientX, y: e.clientY }
    setCenter((c) => clampCenter(image, { x: c.x - dx, y: c.y - dy }, zoom))
  }

  function finish() {
    if (!image) return
    const out = document.createElement('canvas')
    out.width = OUTPUT
    out.height = OUTPUT
    const ctx = out.getContext('2d')
    if (!ctx) return
    const size = cropSize(image, zoom)
    const c = clampCenter(image, center, zoom)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, OUTPUT, OUTPUT)
    ctx.drawImage(image, c.x - size / 2, c.y - size / 2, size, size, 0, 0, OUTPUT, OUTPUT)
    out.toBlob((blob) => (blob ? onDone(blob) : setError('Obrázek se nepodařilo zpracovat.')), 'image/jpeg', 0.9)
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <canvas
        ref={canvas}
        width={PREVIEW}
        height={PREVIEW}
        aria-label="Náhled fotky. Tažením posuň výřez."
        className="mx-auto block touch-none rounded-xl border bg-muted"
        style={{ width: PREVIEW, height: PREVIEW, cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="space-y-2">
        <Label htmlFor="crop-zoom">Přiblížení</Label>
        <input
          id="crop-zoom"
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-11 w-full accent-primary"
        />
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" size="lg" onClick={finish} disabled={!image || pending}>
          {pending ? 'Nahrávám…' : 'Použít fotku'}
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel} disabled={pending}>
          Zrušit
        </Button>
      </div>
    </div>
  )
}
