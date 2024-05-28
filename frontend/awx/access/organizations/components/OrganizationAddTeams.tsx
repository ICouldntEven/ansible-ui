import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LoadingPage,
  PageHeader,
  PageLayout,
  PageWizard,
  PageWizardStep,
  useGetPageUrl,
  usePageNavigate,
} from '../../../../../framework';
import { RoleAssignmentsReviewStep } from '../../../../common/access/RolesWizard/steps/RoleAssignmentsReviewStep';
import { postRequest } from '../../../../common/crud/Data';
import { useGet } from '../../../../common/crud/useGet';
import { AwxSelectRolesStep } from '../../../access/common/AwxRolesWizardSteps/AwxSelectRolesStep';
import { AwxSelectTeamsStep } from '../../../access/common/AwxRolesWizardSteps/AwxSelectTeamsStep';
import { awxErrorAdapter } from '../../../common/adapters/awxErrorAdapter';
import { awxAPI } from '../../../common/api/awx-utils';
import { useAwxBulkActionDialog } from '../../../common/useAwxBulkActionDialog';
import { AwxRbacRole } from '../../../interfaces/AwxRbacRole';
import { Organization } from '../../../interfaces/Organization';
import { Team } from '../../../interfaces/Team';
import { AwxRoute } from '../../../main/AwxRoutes';

interface WizardFormValues {
  teams: Team[];
  awxRoles: AwxRbacRole[];
}

interface TeamRolePair {
  team: Team;
  role: AwxRbacRole;
}

export function OrganizationAddTeams() {
  const { t } = useTranslation();
  const getPageUrl = useGetPageUrl();
  const params = useParams<{ id: string }>();
  const pageNavigate = usePageNavigate();
  const { data: organization, isLoading } = useGet<Organization>(
    awxAPI`/organizations/${params.id ?? ''}/`
  );
  const userProgressDialog = useAwxBulkActionDialog<TeamRolePair>();

  if (isLoading || !organization) return <LoadingPage />;

  const steps: PageWizardStep[] = [
    {
      id: 'teams',
      label: t('Select team(s)'),
      inputs: (
        <AwxSelectTeamsStep
          descriptionForTeamsSelection={t(
            'Select the team(s) that you want to give access to {{organizationName}}.',
            {
              organizationName: organization?.name,
            }
          )}
        />
      ),
      validate: (formData, _) => {
        const { teams } = formData as { teams: Team[] };
        if (!teams?.length) {
          throw new Error(t('Select at least one team.'));
        }
      },
    },
    {
      id: 'roles',
      label: t('Select roles to apply'),
      inputs: (
        <AwxSelectRolesStep
          contentType="organization"
          fieldNameForPreviousStep="teams"
          descriptionForRoleSelection={t('Choose roles to apply to {{organizationName}}.', {
            organizationName: organization?.name,
          })}
        />
      ),
      validate: (formData, _) => {
        const { awxRoles } = formData as { awxRoles: AwxRbacRole[] };
        if (!awxRoles?.length) {
          throw new Error(t('Select at least one role.'));
        }
      },
    },
    {
      id: 'review',
      label: t('Review'),
      inputs: <RoleAssignmentsReviewStep />,
    },
  ];

  const onSubmit = async (data: WizardFormValues) => {
    const { teams, awxRoles } = data;
    const items: TeamRolePair[] = [];
    for (const team of teams) {
      for (const role of awxRoles) {
        items.push({ team, role });
      }
    }
    return new Promise<void>((resolve) => {
      userProgressDialog({
        title: t('Add roles'),
        keyFn: ({ team, role }) => `${team.id}_${role.id}`,
        items,
        actionColumns: [
          { header: t('Team'), cell: ({ team }) => team.name },
          { header: t('Role'), cell: ({ role }) => role.name },
        ],
        actionFn: ({ team, role }) =>
          postRequest(awxAPI`/role_team_assignments/`, {
            team: team.id,
            role_definition: role.id,
            content_type: 'awx.organization',
            object_id: organization.id,
          }),
        onComplete: () => {
          resolve();
        },
        onClose: () => {
          pageNavigate(AwxRoute.OrganizationTeamsAccess, {
            params: { id: organization.id.toString() },
          });
        },
      });
    });
  };

  return (
    <PageLayout>
      <PageHeader
        title={t('Add roles')}
        breadcrumbs={[
          { label: t('Organizations'), to: getPageUrl(AwxRoute.Organizations) },
          {
            label: organization?.name,
            to: getPageUrl(AwxRoute.OrganizationDetails, { params: { id: organization?.id } }),
          },
          {
            label: t('Team Access'),
            to: getPageUrl(AwxRoute.OrganizationTeamsAccess, { params: { id: organization?.id } }),
          },
          { label: t('Add roles') },
        ]}
      />
      <PageWizard<WizardFormValues>
        errorAdapter={awxErrorAdapter}
        steps={steps}
        onSubmit={onSubmit}
        disableGrid
        onCancel={() => {
          pageNavigate(AwxRoute.OrganizationTeamsAccess, { params: { id: organization?.id } });
        }}
      />
    </PageLayout>
  );
}
