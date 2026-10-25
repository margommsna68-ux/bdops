import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({role:'MODERATOR',serverScope:'SELECTED'}));
vi.mock('next/navigation',()=>({usePathname:()=>'/gmails',useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/link',()=>({default:({href,children,...props}:{href:string;children:React.ReactNode})=><a href={href} {...props}>{children}</a>}));
vi.mock('next-auth/react',()=>({useSession:()=>({data:{user:{name:'Fixture',username:'fixture'}}}),signOut:vi.fn()}));
vi.mock('@/components/layout/ProjectSwitcher',()=>({ProjectSwitcher:()=>null}));
vi.mock('@/components/BrandMark',()=>({BrandMark:()=>null,BRAND_NAME:'Fixture',BRAND_SLOGAN:'Fixture'}));
vi.mock('@/lib/store',()=>({useProjectStore:(select?: (s:unknown)=>unknown)=>{const s={currentRole:state.role,currentModules:['INFRASTRUCTURE'],currentProjectId:'p',currentProjectCode:'P',currentProjectName:'Fixture',currentProjectType:'FULL',currentBusinessMode:'PROXY_VM',canManageUsers:false};return select?select(s):s;}}));
vi.mock('@/lib/settings-store',()=>({useSettingsStore:(select:(s:unknown)=>unknown)=>select({theme:'light'})}));
vi.mock('@/lib/i18n',()=>({useT:()=>(key:string)=>key}));
vi.mock('@/lib/collector-utils',()=>({isCollectorOnly:()=>false}));
vi.mock('@/lib/trpc',()=>({trpc:{project:{myMembership:{useQuery:()=>({data:{role:state.role,serverScope:state.serverScope,teamCashEnabled:false}})}},opsApproval:{pendingCount:{useQuery:()=>({data:{count:0}})}}}}));
import {Sidebar} from '@/components/layout/Sidebar';
beforeAll(()=>vi.stubGlobal('React',React));afterAll(()=>vi.unstubAllGlobals());
describe('selected-server human account navigation',()=>{
 it('opens the login store for a manager without adding PayPal, stock writes or global financial navigation',()=>{
  state.role='MODERATOR';const html=renderToStaticMarkup(<Sidebar/>);
  expect(html).toContain('href="/gmails"');expect(html).toContain('href="/infrastructure/servers"');expect(html).toContain('href="/settings"');
  for(const href of ['/paypals','/funds','/withdrawals','/history','/admin/users','/admin/projects'])expect(html).not.toContain(`href="${href}"`);
 });
 it.each(['USER','VIEWER'])('does not add the human account store link for %s',role=>{state.role=role;expect(renderToStaticMarkup(<Sidebar/>)).not.toContain('href="/gmails"');});
});
