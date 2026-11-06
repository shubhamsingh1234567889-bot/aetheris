import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/db/store.js';

test('MemoryStore: CRUD, filtering and org ownership on status changes', async () => {
  const s = new MemoryStore();
  const a = await s.addWasteListing({ orgId: 'o1', kind: 'offer', material: 'fly ash', quantityKg: 10, lat: 1, lon: 1 });
  await s.addWasteListing({ orgId: 'o2', kind: 'need', material: 'fly ash', quantityKg: 5, lat: 1, lon: 1 });
  assert.equal(a.status, 'open');
  assert.equal((await s.listWasteListings({ kind: 'offer', limit: 10 })).length, 1);
  assert.equal(await s.setWasteStatus(a.id, 'someone-else', 'closed'), undefined);
  assert.equal((await s.setWasteStatus(a.id, 'o1', 'closed'))?.status, 'closed');
  assert.equal((await s.listWasteListings({ status: 'open', limit: 10 })).length, 1);

  const f = await s.addFoodSurplus({
    orgId: 'o1', item: 'milk', category: 'dairy', quantityKg: 20, lat: 0, lon: 0,
    packedAt: new Date().toISOString(), refrigerated: true,
  });
  assert.equal(f.status, 'available');
  assert.equal((await s.setFoodStatus(f.id, 'o1', 'dispatched'))?.status, 'dispatched');
  assert.equal((await s.listFoodSurplus({ status: 'available', limit: 10 })).length, 0);

  await s.addCarbonEntry('o1', 'Q1', { total: 1 });
  assert.equal((await s.listCarbonEntries('o1', 10)).length, 1);
  assert.equal((await s.listCarbonEntries('o2', 10)).length, 0);
});
