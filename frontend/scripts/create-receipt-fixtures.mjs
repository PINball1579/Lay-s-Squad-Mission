// Synthetic images and expected provider responses for isolated local E2E only.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory=await mkdtemp(join(tmpdir(),'crunch-receipts-'))
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:undefined)
try{
 const page=await browser.newPage({viewport:{width:420,height:600}})
 const manifest={}
 for(const [name,item] of [['positive',"LAY'S CLASSIC 29.00"],['negative','MINERAL WATER 10.00']]){
  await page.setContent(`<main style="background:white;padding:36px;font:18px monospace;color:black"><h2>TEST STORE</h2><p>SYNTHETIC TEST RECEIPT</p><hr/><p>${item}</p><p>TOTAL 29.00</p><hr/><p>TEST DATA ONLY</p></main>`)
  const image=await page.screenshot();await writeFile(join(directory,`${name}.png`),image)
  manifest[createHash('sha256').update(image).digest('hex')]=`TEST STORE\n${item}\nTOTAL 29.00`
 }
 await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest))
}finally{await browser.close()}
process.stdout.write(directory)
