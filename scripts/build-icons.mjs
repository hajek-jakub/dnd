#!/usr/bin/env node
/**
 * Vygeneruje PNG ikony (favicon, apple-touch-icon, ikony pro "přidat na plochu") z public/logo.svg.
 * Používá Chromium z Playwrightu:  node scripts/build-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const svg = readFileSync(path.join(root, 'public/logo.svg'), 'utf8')
const targets = [
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const [file, size] of targets) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
    writeFileSync(path.join(root, 'public', file), png)
    console.log(`public/${file} (${size}x${size})`)
  }
} finally {
  await browser.close()
}
