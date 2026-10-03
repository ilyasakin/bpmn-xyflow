import { runAnchorFollowups } from './browser-anchor-followup.mjs';
await runAnchorFollowups({ batch: 'b', engine: 'upstream', shardIndex: 0, shardCount: 3 });
