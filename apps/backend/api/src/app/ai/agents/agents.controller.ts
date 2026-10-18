import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { AgentRunsService } from './agent-runs.service';

/** Admin › AI › Agents: what each agent did and proposed, and what the copilot drafted. */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/agents')
@HasPermission(PERMISSIONS.AI_USAGE_VIEW)
export class AgentsController {
  constructor(private readonly runs: AgentRunsService) {}

  @Get('runs')
  @ApiOperation({ summary: 'Recent agent runs, newest first, with their proposals.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('agent') agent?: string, @Query('limit') limit?: string) {
    return this.runs.list(user.organizationId, agent && /^[a-z_]{1,48}$/.test(agent) ? agent : undefined, Number(limit) || 30);
  }

  @Get('copilot-proposals')
  @ApiOperation({ summary: 'What the copilot proposed to draft, and what became of each proposal.' })
  proposals(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.runs.copilotProposals(user.organizationId, Number(limit) || 30);
  }
}
