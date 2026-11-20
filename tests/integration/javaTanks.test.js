import request from 'supertest';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { createAccountDetails, getAuthCookie } from '../helpers/apiFixtures.cjs';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';

let baseUrl, cookie, otherCookie, javaId, normalId;
const source='import tankscript.TankScript; public class MyTank { public void tick(TankScript.Snapshot state, TankScript api) { api.shoot(); } }';
const javaTank={name:'Experimental Java',code:source,language:'java',color:'#317d84'};
beforeAll(async()=>{
  baseUrl=await startLiveService({nodeEnv:'development',experimentalJava:true});
  cookie=getAuthCookie(await request(baseUrl).post('/api/auth/create').send(createAccountDetails()));
  otherCookie=getAuthCookie(await request(baseUrl).post('/api/auth/create').send(createAccountDetails()));
});
afterAll(stopLiveService);

test('development opt-in saves original Java, edits invalid drafts, and preserves ownership',async()=>{
  const created=await request(baseUrl).post('/api/tanks').set('Cookie',cookie).send({tank:{...javaTank,compiledWasm:[1,2],runtime:{}}});
  expect(created.status).toBe(201);
  javaId=created.body.id;
  expect(created.body).toMatchObject(javaTank);
  expect(created.body.compiledWasm).toBeUndefined();
  expect(created.body.runtime).toBeUndefined();
  for(const endpoint of ['/api/tanks','/api/tanks/all']){
    const result=await request(baseUrl).get(endpoint).set('Cookie',cookie);
    expect(result.body.find(tank=>tank.id===javaId)).toMatchObject(javaTank);
  }
  const edit=await request(baseUrl).put('/api/tanks/'+javaId).set('Cookie',cookie).send({tank:{...javaTank,code:'incomplete Java draft'}});
  expect(edit.status).toBe(200);
  const loaded=await request(baseUrl).get('/api/tanks').set('Cookie',cookie);
  expect(loaded.body.find(tank=>tank.id===javaId).code).toBe('incomplete Java draft');
  for(const method of ['put','delete']){
    const response=await request(baseUrl)[method]('/api/tanks/'+javaId).set('Cookie',otherCookie).send({tank:javaTank});
    expect(response.status).toBe(403);
    expect((await request(baseUrl)[method]('/api/tanks/'+javaId).send({tank:javaTank})).status).toBe(401);
  }
  const normal=await request(baseUrl).post('/api/tanks').set('Cookie',cookie).send({tank:{...javaTank,language:'javascript',code:'shoot();'}});
  expect(normal.status).toBe(201);
  normalId=normal.body.id;
});

test.each([
  ['production',true], ['development',false], ['',true],
])('%s with flag %s rejects direct Java writes and hides existing Java',async(nodeEnv,experimentalJava)=>{
  await stopLiveService();
  baseUrl=await startLiveService({nodeEnv,experimentalJava});
  const payload={tank:{...javaTank,experimentalJava:true},VITE_EXPERIMENTAL_JAVA:'true',NODE_ENV:'development'};
  const create=await request(baseUrl).post('/api/tanks').set('Cookie',cookie).send(payload);
  expect(create.status).toBe(400);
  expect(create.body.msg).toContain('disabled');
  expect((await request(baseUrl).put('/api/tanks/'+normalId).set('Cookie',cookie).send(payload)).status).toBe(400);
  for(const endpoint of ['/api/tanks','/api/tanks/all']){
    const loaded=await request(baseUrl).get(endpoint).set('Cookie',cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.some(tank=>tank.id===javaId)).toBe(false);
    expect(loaded.body.some(tank=>tank.id===normalId)).toBe(true);
  }
  for(const method of ['put','delete']){
    expect((await request(baseUrl)[method]('/api/tanks/'+javaId).set('Cookie',cookie).send(payload)).status).toBe(403);
  }
});

test('re-enabling Java reopens the unchanged draft and permits deletion',async()=>{
  await stopLiveService();
  baseUrl=await startLiveService({nodeEnv:'development',experimentalJava:true});
  const loaded=await request(baseUrl).get('/api/tanks').set('Cookie',cookie);
  expect(loaded.body.find(tank=>tank.id===javaId)).toMatchObject({language:'java',code:'incomplete Java draft'});
  expect((await request(baseUrl).delete('/api/tanks/'+javaId).set('Cookie',cookie)).status).toBe(204);
  expect((await request(baseUrl).get('/api/tanks').set('Cookie',cookie)).body.some(tank=>tank.id===javaId)).toBe(false);
});
