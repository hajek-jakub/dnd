import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { emojiOf } from './pin-icons'
import type { MapPin } from './api'

interface Props {
  imageUrl: string
  width: number
  height: number
  pins: MapPin[]
  selectedId: string | null
  /** Klik do mapy v režimu "přidat bod" (souřadnice v pixelech obrázku). */
  addMode: boolean
  onAdd: (x: number, y: number) => void
  onSelect: (id: string) => void
  /** Přesouvání bodů tahem (jen body, které smí uživatel měnit). */
  moveMode: boolean
  onMove: (id: string, x: number, y: number) => void
  /** Změna `n` přiblíží mapu na bod `id` (výběr ze seznamu bodů). */
  focus: { id: string; n: number } | null
}

// Souřadnice obrázku (x doprava, y dolů, v pixelech) <-> Leaflet CRS.Simple (lat nahoru).
const toLatLng = (x: number, y: number, h: number): L.LatLngExpression => [h - y, x]
const clamp = (n: number, max: number) => Math.round(Math.min(max, Math.max(0, n)))

/** Mapa jako obrázek v Leafletu (CRS.Simple): posun, přibližování prsty i kolečkem, body jako značky s emoji. */
export function LeafletMap({ imageUrl, width, height, pins, selectedId, addMode, onAdd, onSelect, moveMode, onMove, focus }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  // Nejnovější handlery bez znovuvytváření mapy při každém renderu.
  const handlers = useRef({ onAdd, onSelect, onMove, addMode })
  useEffect(() => {
    handlers.current = { onAdd, onSelect, onMove, addMode }
  })

  // Mapa se postaví jednou pro daný obrázek.
  useEffect(() => {
    if (!el.current) return
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [height, width],
    ]
    const m = L.map(el.current, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, maxBoundsViscosity: 0.8 })
    L.imageOverlay(imageUrl, bounds).addTo(m)
    m.fitBounds(bounds)
    m.setMaxBounds(L.latLngBounds(bounds).pad(0.5))
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (handlers.current.addMode) handlers.current.onAdd(clamp(e.latlng.lng, width), clamp(height - e.latlng.lat, height))
    })
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    // Po změně velikosti okna (otočení telefonu) se mapa přepočítá.
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      layer.current = null
    }
  }, [imageUrl, width, height])

  // Body se překreslí při každé změně seznamu, výběru nebo režimu přesouvání.
  useEffect(() => {
    const group = layer.current
    if (!group) return
    group.clearLayers()
    for (const p of pins) {
      const icon = L.divIcon({
        className: '',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        html: `<span class="map-pin map-pin--${p.visibility}${p.id === selectedId ? ' map-pin--selected' : ''}">${emojiOf(p.icon)}</span>`,
      })
      const marker = L.marker(toLatLng(p.x, p.y, height), { icon, title: p.title, alt: p.title, keyboard: true, draggable: moveMode && p.canEdit })
      marker.on('click', () => handlers.current.onSelect(p.id))
      marker.on('dragend', () => {
        const ll = marker.getLatLng()
        handlers.current.onMove(p.id, clamp(ll.lng, width), clamp(height - ll.lat, height))
      })
      marker.addTo(group)
    }
  }, [pins, selectedId, moveMode, width, height])

  // Kurzor křížku přes třídu Leafletu: className prvku mapy nesmí měnit React, přepsal by třídy, které tam dal Leaflet
  // (bez `leaflet-container` zmizí obrázek a klepnutí do mapy nefunguje).
  useEffect(() => {
    map.current?.getContainer().classList.toggle('leaflet-crosshair', addMode)
  }, [addMode, imageUrl, width, height])

  // Výběr ze seznamu bodů přiblíží mapu na bod.
  useEffect(() => {
    if (!focus || !map.current) return
    const p = pins.find((x) => x.id === focus.id)
    if (p) map.current.flyTo(toLatLng(p.x, p.y, height), Math.max(map.current.getZoom(), -1), { duration: 0.4 })
    // jen při nové žádosti o přiblížení (nebo když se body teprve načetly), ne při každé změně bodů
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, pins.length === 0])

  return <div ref={el} data-testid="map-canvas" data-add-mode={addMode} className="isolate z-0 h-[60dvh] min-h-80 w-full rounded-xl border bg-muted" />
}
