// Production only; independent expiring approval, default disabled.
import {handleConversation} from './chat-claude-preview.js';
export const onRequest=context=>handleConversation(context,true);
