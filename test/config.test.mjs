import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../qa/config.mjs';
import {stateDir,statePath} from '../state-dir.mjs';
test('defaults keep template behaviour',()=>{
 const c=loadConfig({COWORKER_ID:'cw_1'});
 assert.equal(c.QA_MODE,'template');assert.equal(c.STATE_DIR,'.local');assert.equal(c.QA_MAX_ATTEMPTS_DEFAULT,3);
 assert.equal(c.QA_JOB_POLL_SECONDS,12);assert.equal(c.DETECTOR_MODEL,'onnx-community/grounding-dino-tiny-ONNX');assert.equal(c.OCR_EXACT_MAX_EDIT_RATIO,0.05);
});
test('blank values fall back to defaults',()=>{assert.equal(loadConfig({COWORKER_ID:'cw',QA_MODE:'',STATE_DIR:''}).QA_MODE,'template');});
test('rejects invalid mode',()=>assert.throws(()=>loadConfig({COWORKER_ID:'cw',QA_MODE:'video'}),/QA_MODE/));
test('requires COWORKER_ID',()=>assert.throws(()=>loadConfig({}),/COWORKER_ID/));
test('poll interval cannot go below 10 s',()=>assert.throws(()=>loadConfig({COWORKER_ID:'cw',QA_JOB_POLL_SECONDS:'5'}),/QA_JOB_POLL_SECONDS/));
test('state dir stays inside the project',()=>{
 assert.equal(stateDir({STATE_DIR:'.local/structured'}),'.local/structured');
 assert.equal(statePath('t1.json',{STATE_DIR:'.local/image'}),'.local/image/t1.json');
 assert.throws(()=>stateDir({STATE_DIR:'/tmp/x'}));assert.throws(()=>stateDir({STATE_DIR:'../x'}));assert.throws(()=>statePath('../x.json',{}));
});
