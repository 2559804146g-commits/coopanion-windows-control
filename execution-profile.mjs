import {createHash} from 'node:crypto';
// Adapted from dsh-dafeiyu-deploy assets/breeze-cover/saved-profile.mjs (CC0).
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export const revisionOf=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0,24);
export function executionProfile({voice,reply,capabilities}){
 const result={voice:voice?{modelId:voice.activeModel?.id,provider:voice.activeModel?.type,voiceKey:voice.selectedVoiceKey,speed:voice.speed,volume:voice.volume}:null,reply:reply||{},capabilities:capabilities||null};
 return {...result,revision:revisionOf(result)};
}
