import {prepaidPolicy} from './preview-prepaid.js';
export const LIVE_TEST={id:'jarvis-preview-claude-once-v1',model:'claude-sonnet-4-6',maxOutput:128,maxPromptBytes:2048,inputTokenBound:4096,inputRate:3,outputRate:15,maxMicroUSD:14208,previewDB:'5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0'};
// Old monthly approvals deliberately do not carry over to prepaid spending.
export function previewLivePolicy(request,env,now=Date.now()){return {...prepaidPolicy(request,env,'voice-live-once',now),...LIVE_TEST};}
