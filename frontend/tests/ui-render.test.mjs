import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise every redesigned view with real React rendering, including unavailable data.
const result = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import AppView from './src/AppView.jsx';
      const noop = () => {};
      const p = {
        city: 'Oslo', theme: 'dark', bg: '/backgrounds/kaaba-dusk.webp',
        bgList: ['/backgrounds/kaaba-dusk.webp', '/backgrounds/kaaba-dawn.webp'],
        countdown: { name: 'Asr', atText: '16:32', diffText: '00:42:18' },
        timesText: {Fajr:'04:36',Soloppgang:'06:47',Dhuhr:'13:18',Asr:'16:32',Maghrib:'19:40',Isha:'21:36'},
        activeCoords: {latitude:59.9139,longitude:10.7522},
        qiblaDeg:139, calendarRows:[{date:'2026-09-16',timings:{Fajr:'04:36',Dhuhr:'13:18',Asr:'16:32',Maghrib:'19:40',Isha:'21:36'}}],
        todayIsoForView:'2026-09-16', NB_DAY:new Intl.DateTimeFormat('nb-NO'),
        audioRef:{current:null}, formatPrayerTime:()=> '--:--', formatMetric:()=> '--',
        weatherIcon:()=> '', weatherCodeToText:()=> '', formatCalendarDate:v=>v,
        ModernCompass:()=>React.createElement('div',null,'Compass control'),
        QiblaMap:()=>null, PushControlsAuto:()=>React.createElement('div',null,'Push controls'),
        AutoLocationModal:()=>null,
      };
      export function render(page, extra = {}) { return renderToStaticMarkup(React.createElement(AppView,{...p,...extra,page})); }
    `,
    resolveDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    loader: 'jsx',
  },
  bundle:true, write:false, platform:'node', format:'cjs',
});
const module = { exports:{} };
vm.runInNewContext(result.outputFiles[0].text, { module, exports:module.exports, require: (await import('node:module')).createRequire(import.meta.url), console, process, TextEncoder, TextDecoder, Buffer, setTimeout, clearTimeout });
const {render} = module.exports;

test('home renders all six times and the active prayer', () => {
  const html = render('home');
  for (const value of ['Fajr','Soloppgang','Dhuhr','Asr','Maghrib','Isha','16:32','00:42:18','Test Adhan']) assert.ok(html.includes(value), value);
  assert.match(html,/next-prayer/);
});
test('Qibla retains compass, map access and background choices', () => {
  const html = render('qibla');
  for (const value of ['Compass control','Vis kart','139°','kaaba-dusk.webp','kaaba-dawn.webp','Tilfeldig bakgrunn']) assert.ok(html.includes(value),value);
});
test('calendar preserves distinct Maghrib and Isha times', () => {
  const html=render('calendar');
  assert.match(html,/19:40/); assert.match(html,/21:36/); assert.match(html,/I dag/);
});
test('settings retain push, Adhan, location and dhikr', () => {
  const html=render('more',{quranMode:true});
  for(const value of ['Push controls','Test Adhan','Bruk stedstjenester','Astaghfirullah','Mørkt tema']) assert.ok(html.includes(value),value);
});
test('missing prayer data shows an explicit error without crashing', () => {
  const html=render('home',{countdown:{},times:null,timesText:null,apiError:'Klarte ikke hente bønnetider (API).'});
  assert.match(html,/Tider utilgjengelige/); assert.match(html,/Klarte ikke hente/); assert.match(html,/--:--/);
});
