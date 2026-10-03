import { runPreviewMotion } from './browser-anchor-preview-motion.mjs';
await runPreviewMotion({ gatewayPolicy: 'vertices', outlinePolicy: 'outward', shardIndex: 1, shardCount: 2, basePort: 5430 });
