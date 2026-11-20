/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, jest, test } from '@jest/globals';
import { Battle } from '../../../frontend/src/battle/battle.jsx';
import { getAllTanks } from '../../../frontend/src/services/api.js';
import { createTankScriptBattleRunner } from '../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js';

jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptFeatures.js', () => ({ JAVA_DEBUGGER_ENABLED: true, MAX_JAVA_BATTLE_TANKS: 4 }));
jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js', () => ({ createTankScriptBattleRunner: jest.fn() }));
jest.mock('../../../frontend/src/services/api.js', () => ({ getAllTanks: jest.fn() }));
jest.mock('../../../frontend/src/game/builtInTanks/builtInTanks.js', () => ({ builtInTanks: [] }));
jest.mock('../../../frontend/src/components/ScrambleText.jsx', () => ({ ScrambleText: ({text}) => text }));
const dispose = jest.fn();
const runTick = jest.fn();
beforeEach(() => {
  window.matchMedia = jest.fn().mockReturnValue({matches:false});
  Element.prototype.scrollIntoView = jest.fn();
  getAllTanks.mockResolvedValue({ok:true,data:[]});
  dispose.mockReset().mockResolvedValue(undefined);
  runTick.mockReset().mockResolvedValue({results:[]});
  createTankScriptBattleRunner.mockReset().mockResolvedValue({runTick,dispose});
});

async function loadJava(code='public class MyTank {}', name='Test.java') {
  const file = new File([code],name);
  file.text = async () => code;
  fireEvent.change(screen.getByLabelText('Load Java tank (.java)'),{target:{files:[file]}});
  await screen.findByRole('button',{name:'Add one Test (Java — experimental)'});
}

test('local Java source joins normal participants without any persistence request', async () => {
  render(<Battle username="Pilot" />);
  await loadJava();
  fireEvent.click(screen.getByRole('button',{name:'Add one Test (Java — experimental)'}));
  fireEvent.click(screen.getByRole('button',{name:'Add one Test (Java — experimental)'}));
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Start Battle'})));
  expect(createTankScriptBattleRunner).toHaveBeenCalledWith([
    {tankId:1,source:'public class MyTank {}',language:'java'},
    {tankId:2,source:'public class MyTank {}',language:'java'},
  ],{signal:expect.any(AbortSignal),onStatus:expect.any(Function)});
  fireEvent.click(screen.getByRole('button',{name:'Reset Battle'}));
  expect(createTankScriptBattleRunner.mock.calls[0][1].signal.aborted).toBe(true);
});

test('file loader bounds local input before starting a runtime', async () => {
  render(<Battle username="Pilot" />);
  fireEvent.change(screen.getByLabelText('Load Java tank (.java)'),{target:{files:[new File(['source'],'bad.txt')]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('up to 100 KB');
  fireEvent.change(screen.getByLabelText('Load Java tank (.java)'),{target:{files:[new File(['x'.repeat(100001)],'Large.java')]}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('up to 100 KB'));
  expect(createTankScriptBattleRunner).not.toHaveBeenCalled();
});

test('saved Java tanks join the roster with a four-Java limit', async () => {
  getAllTanks.mockResolvedValue({ok:true,data:[{id:'saved-java',name:'Saved Java',code:'original Java',language:'java',color:'#317d84'}]});
  render(<Battle username="Pilot" />);
  const add=await screen.findByRole('button',{name:/Add one Saved Java/});
  for(let index=0;index<4;index++)fireEvent.click(add);
  expect(add).toBeDisabled();
  expect(screen.getByText(/Java: 4 \/ 4/)).toHaveTextContent('limit reached');
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Start Battle'})));
  expect(createTankScriptBattleRunner.mock.calls[0][0]).toEqual([1,2,3,4].map(tankId=>({tankId,source:'original Java',language:'java'})));
  fireEvent.click(screen.getByRole('button',{name:'Reset Battle'}));
});

test('Java startup status is visible and a reset disposes a late runner', async () => {
  let finish;
  createTankScriptBattleRunner.mockImplementationOnce((_tanks,options)=>{
    options.onStatus('Tank #1: Compiling Java…');
    return new Promise(resolve=>{finish=resolve;});
  });
  render(<Battle username="Pilot" />);
  await loadJava();
  for(let index=0;index<2;index++)fireEvent.click(screen.getByRole('button',{name:'Add one Test (Java — experimental)'}));
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Start Battle'})));
  expect(screen.getByText('Tank #1: Compiling Java…')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Reset Battle'}));
  await act(async()=>finish({runTick,dispose}));
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(runTick).not.toHaveBeenCalled();
});
