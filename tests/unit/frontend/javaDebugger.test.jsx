/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, jest, test } from '@jest/globals';
import { TankEditor } from '../../../frontend/src/tank-editor/tank-editor.jsx';
import { selectSavedTank, selectTankLanguage } from '../../helpers/languageSelector.js';
import { getTanks, createTank, updateTank, deleteTank } from '../../../frontend/src/services/api.js';
import { createTankScriptWorkerRunner } from '../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js';

jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptFeatures.js', () => ({ JAVA_DEBUGGER_ENABLED: true }));
jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js', () => ({ createTankScriptWorkerRunner: jest.fn() }));
jest.mock('../../../frontend/src/services/api.js', () => ({
  getTanks: jest.fn(), createTank: jest.fn(), updateTank: jest.fn(), deleteTank: jest.fn(), generateTankNames: jest.fn(),
}));
jest.mock('../../../frontend/src/tank-editor/editor/localMonacoEditor.js', () => ({
  __esModule: true,
  default: ({value,language,path,onChange}) => <textarea aria-label="Tank code" data-language={language} data-path={path} value={value} onChange={event=>onChange(event.target.value)} />,
}));

const runTick = jest.fn();
const dispose = jest.fn();
beforeEach(() => {
  getTanks.mockResolvedValue({ok:true,data:[]});
  createTank.mockReset(); updateTank.mockReset(); deleteTank.mockReset();
  runTick.mockReset().mockResolvedValue({action:'shoot'});
  dispose.mockReset().mockResolvedValue(undefined);
  createTankScriptWorkerRunner.mockReset().mockResolvedValue({runTick,dispose});
});
async function javaEditor() {
  const view=render(<TankEditor username="Java_Pilot" />);
  await selectTankLanguage('java');
  await screen.findByLabelText('Tank code');
  return view;
}
async function generate() {
  fireEvent.click(screen.getByRole('button',{name:'Generate Command'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Generate Command'})).not.toBeDisabled());
}

test('Java preserves its draft and saves original source without compiling',async()=>{
  await javaEditor();
  const editor=screen.getByLabelText('Tank code');
  expect(editor).toHaveAttribute('data-language','java');
  expect(editor).toHaveAttribute('data-path','MyTank.java');
  expect(screen.getByLabelText('Language').querySelector('img')).toHaveAttribute('src','/language-logos/java.svg');
  expect(editor.value).toContain('public class MyTank');
  fireEvent.change(editor,{target:{value:'my Java draft'}});
  await selectTankLanguage('javascript');
  expect(editor).not.toHaveValue('my Java draft');
  await selectTankLanguage('java');
  expect(editor).toHaveValue('my Java draft');
  fireEvent.change(screen.getByLabelText('Tank name'),{target:{value:'Java tank'}});
  createTank.mockResolvedValue({ok:true,data:{id:'java-1',name:'Java tank',code:'my Java draft',language:'java',color:'#317d84'}});
  expect(screen.getByRole('button',{name:'Save New Tank'})).not.toBeDisabled();
  fireEvent.submit(document.querySelector('form'));
  await waitFor(()=>expect(createTank).toHaveBeenCalledWith(expect.objectContaining({name:'Java tank',code:'my Java draft',language:'java'})));
  expect(await screen.findByText(/was saved/)).toBeInTheDocument();
  expect(createTankScriptWorkerRunner).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Language')).toBeDisabled();
});

test('saved Java reopens, updates and deletes through the existing editor',async()=>{
  const tank={id:'java-2',name:'Saved Java',code:'public class MyTank {}',language:'java',color:'#317d84'};
  getTanks.mockResolvedValue({ok:true,data:[tank]});
  updateTank.mockResolvedValue({ok:true,data:{...tank,code:'edited Java'}});
  deleteTank.mockResolvedValue({ok:true});
  jest.spyOn(window,'confirm').mockReturnValueOnce(true);
  render(<TankEditor username="Pilot" />);
  await selectSavedTank(tank.id);
  expect(screen.getByLabelText('Tank code')).toHaveValue(tank.code);
  expect(screen.getByLabelText('Tank code')).toHaveAttribute('data-language','java');
  fireEvent.change(screen.getByLabelText('Tank code'),{target:{value:'edited Java'}});
  fireEvent.submit(document.querySelector('form'));
  await waitFor(()=>expect(updateTank).toHaveBeenCalledWith(tank.id,expect.objectContaining({language:'java',code:'edited Java'})));
  await screen.findByText(/was updated/);
  fireEvent.click(screen.getByRole('button',{name:'Delete Tank'}));
  await screen.findByText(/was deleted/);
  expect(deleteTank).toHaveBeenCalledWith(tank.id);
  expect(screen.queryByRole('option',{name:'Saved Java'})).not.toBeInTheDocument();
});

test('Java previews reuse one runner, receive fresh snapshots and dispose on edits',async()=>{
  const view=await javaEditor();
  fireEvent.click(screen.getByRole('tab',{name:'Debugger'}));
  await generate(); await generate();
  expect(createTankScriptWorkerRunner).toHaveBeenCalledTimes(1);
  expect(runTick).toHaveBeenCalledTimes(2);
  expect(runTick.mock.calls[0][0]).not.toBe(runTick.mock.calls[1][0]);
  expect(dispose).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Tank code'),{target:{value:'new source'}});
  expect(dispose).toHaveBeenCalledTimes(1);
  await generate();
  expect(createTankScriptWorkerRunner).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(dispose).toHaveBeenCalledTimes(2);
});

test('Java preparation reports progress and cancellation ignores a late completion',async()=>{
  await javaEditor();
  let finish;
  createTankScriptWorkerRunner.mockImplementationOnce((_code,options)=>{
    options.onStatus('Compiling Java…');
    return new Promise(resolve=>{finish=resolve;});
  });
  fireEvent.click(screen.getByRole('tab',{name:'Debugger'}));
  fireEvent.click(screen.getByRole('button',{name:'Generate Command'}));
  expect(await screen.findByText('Compiling Java…')).toBeInTheDocument();
  const signal=createTankScriptWorkerRunner.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole('button',{name:'Cancel Java'}));
  expect(signal.aborted).toBe(true);
  await act(async()=>finish({runTick,dispose}));
  expect(screen.getByText('Java preview cancelled.')).toBeInTheDocument();
  expect(runTick).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalled();
});

test('Leaving the Java Debugger disposes its retained runner',async()=>{
  await javaEditor();
  fireEvent.click(screen.getByRole('tab',{name:'Debugger'}));
  await generate();
  fireEvent.click(screen.getByRole('tab',{name:'API Reference'}));
  expect(dispose).toHaveBeenCalledTimes(1);
});
