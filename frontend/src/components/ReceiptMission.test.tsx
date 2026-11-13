import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReceiptMission } from './ReceiptMission'
import { ApiError } from '../lib/api'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})

describe('receipt mission',()=>{
 it('requires photo and processing consent, then completes only after verified OCR',async()=>{
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn().mockReturnValue('blob:receipt'),revokeObjectURL:vi.fn()}))
  const verify=vi.fn().mockResolvedValue({verified:true,brand:'lays'});const complete=vi.fn().mockResolvedValue(undefined)
  render(<ReceiptMission verify={verify} onComplete={complete}/>);
  const submit=screen.getByRole('button',{name:'ส่งใบเสร็จเพื่อตรวจสอบ'});expect(submit).toBeDisabled()
  const file=new File(['image'],'receipt.png',{type:'image/png'})
  fireEvent.change(screen.getByLabelText('เลือกภาพใบเสร็จ'),{target:{files:[file]}})
  expect(screen.getByAltText('ภาพใบเสร็จที่จะส่งตรวจ')).toBeInTheDocument();expect(submit).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(submit)
  expect(verify).toHaveBeenCalledWith(file);expect(complete).toHaveBeenCalledWith({receiptVerified:true,brand:'lays'})
 })
 it('keeps the mission incomplete and allows retry when no Lays is found',async()=>{
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn().mockReturnValue('blob:receipt'),revokeObjectURL:vi.fn()}))
  const verify=vi.fn().mockRejectedValue(new ApiError(422,'lays_not_found','no match'));const complete=vi.fn()
  render(<ReceiptMission verify={verify} onComplete={complete}/>);
  fireEvent.change(screen.getByLabelText('เลือกภาพใบเสร็จ'),{target:{files:[new File(['image'],'receipt.png',{type:'image/png'})]}})
  await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'ส่งใบเสร็จเพื่อตรวจสอบ'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('ยังไม่พบรายการเลย์');expect(complete).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{name:'ส่งใบเสร็จเพื่อตรวจสอบ'})).toBeEnabled()
 })
})
