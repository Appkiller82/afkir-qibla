
import { subscribeForPush, unsubscribePush, permissionState } from '../push';
export function PushControlsAuto(host: HTMLElement){
  const state={enabled:false,status:'Sjekker…'};const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function getCoords(){return new Promise<{lat:number,lon:number}>((resolve)=>{if(!navigator.geolocation)return resolve({lat:NaN,lon:NaN});navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),_=>resolve({lat:NaN,lon:NaN}),{enableHighAccuracy:false,maximumAge:3600000,timeout:8000});});}
  async function refresh(){const perm=await permissionState() as any;state.enabled=(perm==='granted');state.status=perm==='granted'?'På':(perm==='denied'?'Avslått i iOS-innstillinger':'Krever tillatelse');render();}
  function render(){host.innerHTML=`<div class="row"><button id="toggle">${state.enabled?'Skru av bønnevarsler':'Abonner på bønnevarsler'}</button><span class="muted">Status: ${state.status}</span></div><p class="muted">Du kan også endre dette under Innstillinger → Varslinger.</p>`;host.querySelector('#toggle')!.addEventListener('click',async()=>{try{if(!state.enabled){const coords=await getCoords();await subscribeForPush({lat:coords.lat,lon:coords.lon,tz});}else{await unsubscribePush();}await refresh();alert('Bønnevarsler er '+(state.enabled?'skrudd av':'aktivert'));}catch(e:any){alert(e?.message||'Noe gikk galt');}});}
  refresh();
}
