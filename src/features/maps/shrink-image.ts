/**
 * Velký obrázek se před nahráním zmenší (nejvýš `maxSide` px na delší straně, JPEG), aby se na server nevlekly desítky MB.
 * Malé obrázky se posílají beze změny. Server obrázek stejně vždy přegeneruje.
 */
export async function shrinkImage(file: File, maxSide = 4096): Promise<{ blob: Blob; filename: string }> {
  if (file.size < 3 * 1024 * 1024) return { blob: file, filename: file.name }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (blob && blob.size < file.size) return { blob, filename: 'mapa.jpg' }
  } catch {
    // formát, který prohlížeč neumí dekódovat: pošle se původní soubor a rozhodne server
  }
  return { blob: file, filename: file.name }
}
