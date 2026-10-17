import {describe,expect,it} from 'vitest';
import {statusInfo,type StatusVM} from '@/components/vm-management/vm-grid/status-actions';
const all={assign:true,confirm:true,copy:true,sourceConnected:true},viewer={assign:false,confirm:false,copy:false,sourceConnected:true};
const cfg=(o:Partial<NonNullable<StatusVM['desired']>>={})=>({id:'c1',endpointId:'e1',version:2,status:'PLANNED',startedAt:null,failureNote:null,ip:'1.2.3.4',port:80,...o});
const hold=(o={})=>({endpointId:'e1',ip:'1.2.3.4',role:'DESIRED',state:'LIVE',owner:'SELF',...o});
const vm=(o:Partial<StatusVM>={}):StatusVM=>({archivedAt:null,slotState:'BLANK',desired:null,installed:null,holds:[],...o});
const kinds=(v:StatusVM,r=all)=>statusInfo(v,r).actions.map(a=>a.kind);
describe('Tình trạng cell actions',()=>{
  it('missing proxy offers autofill and the assignment panel directly',()=>{expect(statusInfo(vm(),all).label).toBe('Thiếu proxy');expect(kinds(vm())).toEqual(['AUTOFILL','ASSIGN']);});
  it('waiting to install offers start and copy-to-install; never confirm before a start',()=>{const v=vm({slotState:'FULL',desired:cfg(),holds:[hold()]});expect(statusInfo(v,all).label).toBe('Chờ cài');expect(kinds(v)).toEqual(['START','COPY_INSTALL','CHANGE_PROXY']);});
  it('installing offers confirm with the exact configuration, and failure note',()=>{const v=vm({slotState:'FULL',desired:cfg({status:'IN_PROGRESS',startedAt:'2026-10-17T00:00:00Z'}),holds:[hold()]});const s=statusInfo(v,all);expect(s.label).toBe('Đang cài');expect(kinds(v)).toEqual(['CONFIRM','FAIL','CHANGE_PROXY']);expect(s.target).toEqual({ip:'1.2.3.4',port:80,version:2});});
  it('failed install keeps confirm possible and shows the note',()=>{const v=vm({slotState:'FULL',desired:cfg({status:'FAILED',startedAt:'2026-10-17T00:00:00Z',failureNote:'Không vào được máy'}),holds:[hold()]});const s=statusInfo(v,all);expect(s.label).toBe('Cài chưa xong');expect(s.reason).toContain('Không vào được máy');expect(kinds(v)).toContain('CONFIRM');});
  it('a proxy of unknown owner cannot be started or confirmed: change it or check the registry',()=>{const v=vm({slotState:'FULL',desired:cfg({status:'FAILED',startedAt:'x'}),holds:[hold({owner:'UNKNOWN'})]});const s=statusInfo(v,all);expect(s.label).toBe('Cần kiểm tra');expect(kinds(v)).toEqual(['OPEN_REGISTRY','CHANGE_PROXY']);expect(s.reason).toContain('chưa rõ sở hữu');});
  it('installed offers only a proxy change; deleted offers nothing',()=>{const c=cfg({status:'CONFIRMED'});expect(kinds(vm({slotState:'FULL',desired:c,installed:c,holds:[hold({role:'INSTALLED'})]}))).toEqual(['CHANGE_PROXY']);expect(kinds(vm({archivedAt:'x'}))).toEqual([]);});
  it('view-only users get no write actions and a clear note; no source means no assignment',()=>{const v=vm({slotState:'FULL',desired:cfg(),holds:[hold()]});expect(kinds(v,viewer)).toEqual([]);expect(statusInfo(v,viewer).readOnlyNote).toContain('Chỉ xem');expect(kinds(vm(),{...all,sourceConnected:false})).toEqual([]);});
});
