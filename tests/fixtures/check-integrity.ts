import fs from 'node:fs';
import path from 'node:path';
import { GatewayStore } from '../../src/server/gatewayStore';
import { createMcpHandler } from '../../src/server/mcpHandler';

const output = process.argv[2];
const dataFile = path.join(path.dirname(output), 'state.json');
const store = new GatewayStore({ dataFile });
store.updateServer('fixture', { env: {} });
const handle = createMcpHandler(store);
const request = (id: string, method: string, params: Record<string, unknown> = {}) => handle({ jsonrpc: '2.0', id, method, params }, { hostName: 'Codex CLI' });
await request('list-clean', 'tools/list');
const cleanCall = await request('clean', 'tools/call', { name: 'fixture__echo', arguments: { text: 'clean-call' } });
store.updateServer('fixture', { env: { FIXTURE_POISON: '1' } });
await request('list-poison', 'tools/list');
const poisonCall = await request('poison', 'tools/call', { name: 'fixture__echo', arguments: { text: 'must-not-forward' } });
const listAfterPoison = await request('list-poison-visible', 'tools/list');
const snapshot = store.getSnapshot();
const result: Record<string, any> = {
  cleanCall,
  poisonCall,
  listed: listAfterPoison.result.tools.find((tool: any) => tool.name === 'fixture__echo'),
  quarantine: snapshot.quarantines.find(q => q.serverId === 'fixture'),
  lock: JSON.parse(fs.readFileSync(process.env.TOOLBOX_LOCK_FILE!, 'utf8')),
};
await new Promise(resolve => setTimeout(resolve, 300));
await store.closeMcpConnections();
const restarted = new GatewayStore({ dataFile });
const restartedHandle = createMcpHandler(restarted);
await restartedHandle({ jsonrpc: '2.0', id: 'restarted-list', method: 'tools/list' });
result.restartState = restarted.getSnapshot().servers.find(server => server.id === 'fixture')?.state;
result.restartCall = await restartedHandle({ jsonrpc: '2.0', id: 'still-poisoned', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'still-blocked' } } });
const rejectedRollback = await restarted.resolveQuarantine('fixture', 'rollback');
result.rollbackConflict = rejectedRollback.conflict;
restarted.updateServer('fixture', { env: {} });
await restarted.refreshMcpTools();
const acceptedRollback = await restarted.resolveQuarantine('fixture', 'rollback');
result.rollbackRecovered = !acceptedRollback.conflict && acceptedRollback.server?.state === 'ok';
result.restoredCall = await restartedHandle({ jsonrpc: '2.0', id: 'restored', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'after-rollback' } } });
restarted.updateServer('fixture', { env: { FIXTURE_POISON: '1' } });
await restarted.refreshMcpTools();
const trusted = await restarted.resolveQuarantine('fixture', 'trust');
result.trustRecovered = !trusted.conflict && trusted.server?.state === 'ok';
result.trustedCall = await restartedHandle({ jsonrpc: '2.0', id: 'trusted', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'after-trust' } } });
result.trustedLock = JSON.parse(fs.readFileSync(process.env.TOOLBOX_LOCK_FILE!, 'utf8'));
result.trustAudit = restarted.getSnapshot().auditLogs.find(event => event.outcome === 'trusted');
await restarted.closeMcpConnections();

const corruptLockFile = path.join(path.dirname(output), 'corrupt-lock.json');
const corruptOriginal = '{broken lock';
fs.writeFileSync(corruptLockFile, corruptOriginal);
const corruptStore = new GatewayStore({ dataFile: path.join(path.dirname(output), 'corrupt-state.json'), lockFile: corruptLockFile });
corruptStore.updateServer('fixture', { env: {} });
const corruptCall = createMcpHandler(corruptStore);
await corruptCall({ jsonrpc: '2.0', id: 'corrupt-list', method: 'tools/list' });
result.corruptLockState = corruptStore.getSnapshot().servers.find(server => server.id === 'fixture')?.state;
result.corruptLockOriginal = fs.readFileSync(corruptLockFile, 'utf8');
result.corruptCall = await corruptCall({ jsonrpc: '2.0', id: 'corrupt-call', method: 'tools/call', params: { name: 'fixture__echo', arguments: { text: 'corrupt-lock-blocked' } } });
result.corruptTrust = await corruptStore.resolveQuarantine('fixture', 'trust');
result.corruptLockAfterTrust = fs.readFileSync(corruptLockFile, 'utf8');
await corruptStore.closeMcpConnections();
fs.writeFileSync(output, JSON.stringify(result));
process.exit(0);
