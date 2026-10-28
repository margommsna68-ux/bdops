import {router,protectedProcedure} from '../trpc';
import {domain} from './businessManagement';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {FleetCreate,FleetIdentity,FleetList,FleetControl} from '../fleet-commands/schema';
import {createFleetCommand,readFleetCommand,listFleetCommands,cancelFleetCommand,readFleetControl} from '../fleet-commands/service';

// Web and Telegram adapters share these services. No browser-to-AE or financial route.
export const fleetCommandsRouter=router({
 control:protectedProcedure.input(FleetControl).query(({ctx,input})=>domain(async()=>readFleetControl(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 create:protectedProcedure.input(FleetCreate).mutation(({ctx,input})=>domain(async()=>createFleetCommand(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 detail:protectedProcedure.input(FleetIdentity).query(({ctx,input})=>domain(async()=>readFleetCommand(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 list:protectedProcedure.input(FleetList).query(({ctx,input})=>domain(async()=>listFleetCommands(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
 cancel:protectedProcedure.input(FleetIdentity).mutation(({ctx,input})=>domain(async()=>cancelFleetCommand(await loadInfrastructureScope(ctx.prisma,ctx.user.id,input.projectId),input,ctx.prisma))),
});
