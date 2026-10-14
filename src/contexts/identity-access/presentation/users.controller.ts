import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ChangeUserRolesUseCase, InviteUserUseCase, ListUsersQuery, RemoveUserAccessUseCase, roleCatalog } from '../application/users.use-cases';
import { ChangeRolesDto, InviteUserDto, RolesResponseDto, UserIdParam, UsersResponseDto } from './dto';

@ApiTags('Utilizadores')
@ApiCookieAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly listUsers: ListUsersQuery,
    private readonly inviteUser: InviteUserUseCase,
    private readonly changeRoles: ChangeUserRolesUseCase,
    private readonly removeAccess: RemoveUserAccessUseCase,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'Utilizadores com acesso e convites pendentes', description: 'Permissão: `users.manage`.' })
  @ApiOkResponse({ type: UsersResponseDto })
  list() {
    return this.listUsers.execute();
  }

  @Post('users/invitations')
  @ApiOperation({ summary: 'Convidar utilizador', description: 'Envia o convite por e-mail (válido 7 dias). Permissão: `users.manage`.' })
  invite(@Body() body: InviteUserDto) {
    return this.inviteUser.execute(body);
  }

  @Patch('users/:userId/roles')
  @ApiOperation({ summary: 'Alterar papéis do utilizador', description: 'Registado na auditoria. Permissão: `users.manage`.' })
  update(@Param() params: UserIdParam, @Body() body: ChangeRolesDto) {
    return this.changeRoles.execute(params.userId, body);
  }

  @Delete('users/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remover acesso', description: 'Termina de imediato as sessões abertas. Permissão: `users.manage`.' })
  @ApiNoContentResponse()
  async remove(@Param() params: UserIdParam) {
    await this.removeAccess.execute(params.userId);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Papéis e respectivas permissões (docs/05)' })
  @ApiOkResponse({ type: RolesResponseDto })
  roles() {
    return roleCatalog();
  }
}
