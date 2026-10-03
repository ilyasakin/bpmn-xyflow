import { runAnchorFollowups } from './browser-anchor-followup.mjs';
await runAnchorFollowups({ batch: 'b', engine: 'local', shardIndex: 2, shardCount: 3 });
