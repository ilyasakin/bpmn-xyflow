import { runAnchorFollowups } from './browser-anchor-followup.mjs';
await runAnchorFollowups({ batch: 'b', engine: 'upstream', shardIndex: 2, shardCount: 3 });
