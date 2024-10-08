//Tests a user's ability to create, edit, and delete an decision environment in the EDA UI.
import { randomString } from '../../../../framework/utils/random-string';
import { cyLabel } from '../../../support/cyLabel';
import { edaAPI } from '../../../support/formatApiPathForEDA';
import { EdaOrganization } from '../../../../frontend/eda/interfaces/EdaOrganization';

cyLabel(['aaas-unsupported'], function () {
  describe('EDA decision environment- Create, Edit, Delete', () => {
    let edaOrg: EdaOrganization;
    before(() => {
      cy.createEdaOrganization().then((organization) => {
        edaOrg = organization;
      });
    });
    after(() => {
      cy.deleteEdaOrganization(edaOrg);
    });

    it('can create an decision environment and assert the information showing on the details page', () => {
      const de_name = 'E2E Decision Environment ' + randomString(4);
      cy.navigateTo('eda', 'decision-environments');
      cy.verifyPageTitle('Decision Environments');
      cy.clickButton(/^Create decision environment$/);
      cy.get('[data-cy="name"]').type(de_name);
      cy.selectSingleSelectOption('[data-cy="organization_id"]', 'Default');
      cy.get('[data-cy="image-url"]').type('quay.io/ansible/ansible-rulebook:main');
      cy.clickButton(/^Create decision environment$/);
      cy.verifyPageTitle(de_name);
      cy.getEdaDecisionEnvironmentByName(de_name).then((de) => {
        cy.wrap(de).should('not.be.undefined');
        if (de) cy.deleteEdaDecisionEnvironment(de);
      });
    });

    it('can verify edit functionality of a decision environment', () => {
      cy.createEdaDecisionEnvironment(edaOrg?.id).then((edaDE) => {
        cy.navigateTo('eda', 'decision-environments');
        cy.verifyPageTitle('Decision Environments');
        cy.get('button[aria-label="table view"]').click();
        cy.filterTableByTextFilter('name', edaDE.name, { disableFilterSelection: true });
        cy.contains('td', edaDE.name).within(() => {
          cy.get('a').click();
        });
        cy.clickButton(/^Edit decision environment$/);
        cy.verifyPageTitle(`Edit ${edaDE.name}`);
        cy.get('[data-cy="name"]').type(edaDE.name + 'edited');
        cy.clickButton(/^Save decision environment$/);
        cy.verifyPageTitle(`${edaDE.name}edited`);
        cy.deleteEdaDecisionEnvironment(edaDE);
      });
    });

    it('can delete a decision environment from the details page', () => {
      cy.createEdaDecisionEnvironment(edaOrg?.id).then((edaDE) => {
        cy.navigateTo('eda', 'decision-environments');
        cy.verifyPageTitle('Decision Environments');
        cy.get('button[aria-label="table view"]').click();
        cy.filterTableByTextFilter('name', edaDE.name, { disableFilterSelection: true });
        cy.contains('td', edaDE.name).within(() => {
          cy.get('a').click();
        });
        cy.verifyPageTitle(edaDE.name);
        cy.intercept('DELETE', edaAPI`/decision-environments/${edaDE.id.toString()}/`).as(
          'deleteDE'
        );
        cy.clickPageAction('delete-decision-environment');
        cy.clickModalConfirmCheckbox();
        cy.clickModalButton('Delete decision environments');
        cy.wait('@deleteDE').then((deleteDE) => {
          expect(deleteDE?.response?.statusCode).to.eql(204);
        });
        cy.verifyPageTitle('Decision Environments');
      });
    });
  });
});
