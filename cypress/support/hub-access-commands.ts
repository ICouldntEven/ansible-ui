import { randomString } from '../../framework/utils/random-string';
import { hubAPI } from './formatApiPathForHub';
import { HubUser } from '../../frontend/hub/interfaces/expanded/HubUser';
import { HubTeam } from '../../frontend/hub/interfaces/expanded/HubTeam';

Cypress.Commands.add('createHubUser', (hubUser?: Partial<HubUser>) => {
  cy.requestPost<HubUser, Partial<HubUser> & { username?: string; password?: string }>(
    hubAPI`/_ui/v2/users/`,
    {
      username: `hub-user${randomString(4)}`,
      password: `${randomString(10)}`,
      ...hubUser,
    }
  ).then((hubUser) => {
    Cypress.log({
      displayName: 'HUB USER CREATION :',
      message: [`Created 👉  ${hubUser.username}`],
    });
    return hubUser;
  });
});

Cypress.Commands.add('deleteHubUser', (user: HubUser, options?: { failOnStatusCode?: boolean }) => {
  cy.requestDelete(hubAPI`/_ui/v2/users/${user.id.toString()}/`, options);
});

Cypress.Commands.add('createHubTeam', () => {
  cy.requestPost<HubTeam>(hubAPI`/_ui/v2/teams/`, {
    name: `hub-team${randomString(4)}`,
  }).then((hubTeam) => {
    Cypress.log({
      displayName: 'HUB TEAM CREATION :',
      message: [`Created 👉  ${hubTeam.name}`],
    });
    return hubTeam;
  });
});

Cypress.Commands.add('deleteHubTeam', (team: HubTeam, options?: { failOnStatusCode?: boolean }) => {
  cy.requestDelete(hubAPI`/_ui/v2/teams/${team.id.toString()}/`, options);
});
