import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

async function compile(relative) {
  return (await build({ entryPoints:[fileURLToPath(new URL(relative, import.meta.url))], bundle:true, write:false, platform:'node', format:'cjs' })).outputFiles[0].text;
}
const serverCode = await compile('../../netlify/functions/irn-month.ts');
const libCode = await compile('../../netlify/functions/lib/irn.ts');
const clientCode = await compile('../src/prayer.ts');
const location = {pk:181, name:'Oslo', district_code:'NO0301'};
const data = Array.from({length:30}, (_,i) => ({date:`${i+1}-09-2026`, district_code:'NO0301', fajr:'04:34', shuruq_sunrise:'06:47', duhr:'13:21', asr:'16:29', shadow_2x:'17:21', maghrib:'19:41', isha:'21:36'}));
const response = (value, status=200) => new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json'}});
function moduleFor(code, fetcher, env={IRN_API_KEY:'test-secret'}) {
  const box = {module:{exports:{}}, exports:{}, process:{env}, fetch:fetcher, URL, URLSearchParams, AbortSignal, console, window:{location:{origin:'https://example.test'}}};
  vm.runInNewContext(code, box);
  return box.module.exports;
}
const event = {httpMethod:'GET', queryStringParameters:{lat:'59.9139',lon:'10.7522',month:'9',year:'2026'}};

test('IRN month uses municipality ID, official Asr and no offsets; token stays server-side', async () => {
  const calls=[];
  const api=moduleFor(serverCode, async (url, options) => {
    calls.push(String(url));
    if (String(url).includes('geonorge')) { assert.equal(options.headers, undefined); return response({kommunenummer:'0301'}); }
    assert.equal(options.headers['Api-Token'],'test-secret');
    return response(String(url).endsWith('/locations/') ? [location] : data);
  });
  const result=await api.handler(event), body=JSON.parse(result.body);
  assert.equal(result.statusCode,200);
  assert.equal(body.rows.length,30);
  assert.equal(body.rows[15].date,'2026-09-16');
  assert.equal(body.rows[15].timings.Asr,'16:29');
  assert.equal(body.rows[15].timings.Dhuhr,'13:21');
  assert.equal(body.rows[15].timings.Maghrib,'19:41');
  assert.ok(calls.includes('https://api.bonnetid.no/prayertimes/181/2026/9/'));
  assert.ok(!result.body.includes('test-secret'));
});
test('foreign point inside bounding box does not call IRN', async () => {
  let count=0;
  const api=moduleFor(serverCode, async () => { count++; return response({},404); });
  const result=await api.handler(event);
  assert.equal(JSON.parse(result.body).source,'not_norway');
  assert.equal(count,1);
});
test('unavailable geocoding never guesses Norway or foreign country', async () => {
  const api=moduleFor(serverCode, async () => response({},503));
  assert.equal((await api.handler(event)).statusCode,503);
});
test('missing server key fails explicitly', async () => {
  const api=moduleFor(serverCode, async () => response({kommunenummer:'0301'}), {});
  assert.equal(JSON.parse((await api.handler(event)).body).code,'IRN_NOT_CONFIGURED');
});
test('bad input does not call upstream', async () => {
  const api=moduleFor(serverCode, () => {throw Error('must not fetch');});
  assert.equal((await api.handler({...event,queryStringParameters:{...event.queryStringParameters,month:'13'}})).statusCode,400);
  assert.equal((await api.handler({...event,httpMethod:'POST'})).statusCode,405);
});
test('unknown or ambiguous municipality is not replaced by a nearby city', () => {
  const api=moduleFor(libCode);
  assert.throws(()=>api.selectLocation([location],'9999'));
  assert.throws(()=>api.selectLocation([location,location],'0301'));
});
test('reject incomplete months, invalid times, wrong district and duplicate dates', () => {
  const api=moduleFor(libCode);
  for (const rows of [data.slice(1),data.map((d,i)=>i?d:{...d,isha:null}),data.map((d,i)=>i?d:{...d,district_code:'NO4601'}),data.map((d,i)=>i?d:{...d,date:'2-09-2026'})]) {
    assert.throws(()=>api.normalizeMonth(rows,location,2026,9));
  }
});
test('frontend preserves official IRN times and source', async () => {
  const api=moduleFor(clientCode,async()=>response({source:'irn',rows:[{date:'2026-09-16',timings:{Fajr:'04:34',Sunrise:'06:47',Dhuhr:'13:21',Asr:'16:29',Maghrib:'19:41',Isha:'21:36'},source:'irn',sourceLocation:'Oslo'}]}));
  const rows=await api.fetchMonthTimings(59.9,10.7,9,2026,'Europe/Oslo','NO');
  assert.equal(rows[0].timings.Asr,'16:29'); assert.equal(rows[0].timings.Maghrib,'19:41'); assert.equal(rows[0].sourceLocation,'Oslo');
});
test('frontend does not silently fall back when IRN fails', async () => {
  let count=0;
  const api=moduleFor(clientCode,async()=>{count++;return response({error:'IRN unavailable'},503);});
  await assert.rejects(api.fetchMonthTimings(59.9,10.7,9,2026,'Europe/Oslo','NO'));
  assert.equal(count,1);
});
test('foreign cities retain Aladhan with no Norway tuning, including Sweden', async () => {
  for (const [lat,lon] of [[48.85,2.35],[59.33,18.07]]) {
    const api=moduleFor(clientCode,async url=>{
      const u=new URL(url);
      if(u.pathname==='/api/irn-month')return response({source:'not_norway'});
      assert.equal(u.pathname,'/api/aladhan-month'); assert.equal(u.searchParams.has('method'),false);
      return response({rows:[{date:'2026-09-16',timings:{Fajr:'05:00',Sunrise:'07:00',Dhuhr:'13:00',Asr:'16:00',Maghrib:'19:00',Isha:'21:00'}}]});
    });
    const rows=await api.fetchMonthTimings(lat,lon,9,2026,'Europe/Paris','NO');
    assert.equal(rows[0].source,'aladhan'); assert.equal(rows[0].timings.Dhuhr,'13:00');
  }
});

test('live IRN + Kartverket municipality and month validation', {skip:!process.env.IRN_API_KEY}, async () => {
  const api=moduleFor(serverCode,fetch,{IRN_API_KEY:process.env.IRN_API_KEY});
  for (const [city,lat,lon] of [['Oslo',59.9139,10.7522],['Bergen',60.3913,5.3221],['Tromsø',69.6492,18.9553],['Stavanger',58.97,5.7331],['Trondheim',63.4305,10.3951]]) {
    const r=await api.handler({...event,queryStringParameters:{...event.queryStringParameters,lat:String(lat),lon:String(lon)}});
    const body=JSON.parse(r.body);
    assert.equal(r.statusCode,200,`${city}: ${r.body}`); assert.equal(body.rows.length,30); assert.ok(body.location.name.startsWith(city));
    console.log(`${city}: IRN ${body.rows[15].date}, Asr ${body.rows[15].timings.Asr}, 30 validated days`);
  }
});

