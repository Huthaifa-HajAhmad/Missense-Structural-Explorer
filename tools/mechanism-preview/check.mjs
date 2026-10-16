#!/usr/bin/env node
/** Recorded/illustrative fixtures only. Run against the local Vite preview. */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = [process.env.PLAYWRIGHT_MODULE,
  path.join(root, 'node_modules/playwright-core/index.mjs'),
  path.join(root, 'scratch/literature-browser/node_modules/playwright-core/index.mjs')];
const modulePath = candidates.find(p => p && existsSync(p));
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright-core/index.mjs.');
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
const executablePath = [process.env.BROWSER_PATH, process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const output = path.join(root, 'scratch/mechanism-preview');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const errors = [], checks = [];
try {
const page=await browser.newPage({viewport:{width:1500,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
const check=(name,pass)=>{checks.push({name,pass});if(!pass)console.log('FAIL',name)};
await page.goto(process.env.MECHANISM_PREVIEW_URL ?? 'http://127.0.0.1:5186/tools/mechanism-preview/index.html');
await page.locator('[data-testid="interface-track"]').waitFor();
await page.waitForTimeout(700);
await page.locator('[data-testid="interface-track"]').getByRole('button',{name:'SOD1 fibril',exact:true}).click();
check('Fibril pin retains denominator',(await page.getByRole('region',{name:'Selected evidence reading'}).innerText()).includes('4 of 15'));
await page.getByRole('button',{name:'Fibril contacts 1',exact:true}).click();
check('Hidden layer pin notice',await page.getByText(/outside the current view or filter/).isVisible());
await page.getByRole('button',{name:'Show selected reading'}).click();
check('Explicit record focus',await page.evaluate(()=>document.activeElement.textContent==='SOD1 fibril'));
await page.setViewportSize({width:390,height:1100});
check('Interface records no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.locator('[data-reading-key="solved:P00441:fibril"]').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-interface-records-390.png'});
await page.setViewportSize({width:1500,height:1100});
await page.getByRole('tab',{name:'Partners',exact:true}).click();
await page.getByRole('searchbox').fill('ZXDC');
await page.locator('[data-testid="partner-grid"]').getByRole('button',{name:'ZXDC',exact:true}).click();
await page.getByLabel('Evidence',{exact:true}).selectOption('splicing');
await page.getByLabel('Evidence',{exact:true}).selectOption('interfaces');
check('Search survives remount',(await page.getByRole('searchbox').inputValue())==='ZXDC');
await page.getByRole('searchbox').fill('');
await page.getByRole('button',{name:'Clear pin',exact:true}).click();
await page.locator('.ifc-partners__head').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-partners-light.png'});
await page.setViewportSize({width:390,height:1100});
check('Partners no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.locator('[data-testid="partner-grid"]').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-partners-390.png'});
await page.setViewportSize({width:1500,height:1100});
await page.getByRole('tab',{name:'Interface map',exact:true}).click();
await page.getByRole('button',{name:'Fibril contacts 1',exact:true}).click();
await page.getByRole('button',{name:'Around Ala5',exact:true}).click();
check('Near window',await page.getByText(/Residues 1.65/).isVisible());
await page.getByRole('button',{name:'Whole protein',exact:true}).click();
for(const width of [1500,800,390]){
 await page.setViewportSize({width,height:1100});
 await page.locator('[data-testid="interface-track"]').scrollIntoViewIfNeeded();
 check('Interface no page overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${output}/mechanism-interface-${width}-light.png`});
}
await page.setViewportSize({width:1500,height:1100});
await page.locator('.mx-support').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-support-light.png'});
await page.getByRole('button',{name:'Switch theme',exact:true}).click();
await page.locator('[data-testid="interface-track"]').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-interface-dark.png'});
await page.getByLabel('Example',{exact:true}).selectOption('SLC12A4');
await page.locator('[data-testid="interface-track"]').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-interface-slc12a4.png'});
await page.getByLabel('Evidence',{exact:true}).selectOption('splicing');
await page.getByLabel('Example',{exact:true}).selectOption('Splice signals');
await page.locator('.spl-map').waitFor();
await page.getByLabel('Map view',{exact:true}).selectOption('50');
await page.locator('[data-testid="map-ds_al"]').focus();
await page.keyboard.press('Enter');
check('Keyboard splice pin',(await page.getByRole('region',{name:'Selected evidence reading'}).innerText()).includes('Acceptor loss'));
await page.getByRole('tab',{name:'Channel details',exact:true}).click();
await page.setViewportSize({width:390,height:1100});
check('Splice records no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.locator('tr[data-row-key="spliceai-ds_al"]').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-splice-records-390.png'});
await page.setViewportSize({width:1500,height:1100});
await page.getByRole('tab',{name:'Splice map',exact:true}).click();
check('Splice window survives records',(await page.getByLabel('Map view',{exact:true}).inputValue())==='50');
for(const width of [1500,800,390]){
 await page.setViewportSize({width,height:1100});
 await page.locator('.spl-map').scrollIntoViewIfNeeded();
 check('Splice no page overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${output}/mechanism-splice-${width}-dark.png`});
}
await page.getByLabel('Example',{exact:true}).selectOption('Missing position');
await page.waitForFunction(()=>document.querySelector('.spl-figure')?.textContent?.includes('0.9'));
check('Unpositioned maximum blocks focus',await page.locator('option[value=focused]').evaluate(e=>e.disabled));
await page.getByLabel('Example',{exact:true}).selectOption('Unresolved strand');
await page.waitForFunction(()=>document.querySelector('[data-testid="geometry-facts"]')?.textContent?.includes('Strand not resolved'));
check('Unresolved strand omits predicted positions',await page.locator('.spl-map__pred').count()===0);
await page.getByLabel('Example',{exact:true}).selectOption('Missing');
check('Missing is not zero',(await page.locator('[data-testid="splicing-finding"]').innerText()).includes('No SpliceAI score'));
await page.getByLabel('Example',{exact:true}).selectOption('New variant');
check('New variant clears pin',(await page.getByRole('region',{name:'Selected evidence reading'}).innerText()).includes('Select a point or source record'));
await page.setViewportSize({width:1500,height:1100});
await page.getByRole('button',{name:'Switch theme',exact:true}).click();
await page.locator('.spl-map').scrollIntoViewIfNeeded();
await page.screenshot({path:output + '/mechanism-splice-light.png'});
check('Adjacent splice labels do not overlap',await page.locator('.spl-map').evaluate(svg=>{
 const labels=[...svg.querySelectorAll('.spl-map__site-name')].map(e=>e.getBoundingClientRect());
 return labels.every((a,i)=>labels.slice(i+1).every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));
}));
await fs.writeFile(output + '/mechanism-browser-results.json',JSON.stringify({checks,errors},null,2));
console.log(JSON.stringify({checks,errors}));
} finally { await browser.close(); }
if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;
