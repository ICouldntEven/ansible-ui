import { useTranslation } from 'react-i18next';
import { PageHeader, PageLayout } from '../../../../framework';
import { useAwxConfig } from '../../common/useAwxConfig';
import { useGetDocsUrl } from '../../common/util/useGetDocsUrl';
import { ActivityStreamIcon } from '../../common/ActivityStreamIcon';
import { ExecutionEnvironmentsList } from './ExecutionEnvironmentsList';

export function ExecutionEnvironments() {
  const { t } = useTranslation();
  const config = useAwxConfig();

  return (
    <PageLayout>
      <PageHeader
        title={t('Execution Environments')}
        description={t(
          'An execution environment allows you to have a customized image to run jobs.'
        )}
        titleHelpTitle={t('Execution Environments')}
        titleHelp={[
          t('An execution environment allows you to have a customized image to run jobs.'),
          t(
            'Execution environments are container images that make it possible to incorporate system-level dependencies and collection-based content. Each execution environment allows you to have a customized image to run jobs, and each of them contain only what you need when running the job, nothing more.'
          ),
        ]}
        titleDocLink={useGetDocsUrl(config, 'executionEnvironments')}
        headerActions={<ActivityStreamIcon type={'execution_environment'} />}
      />
      <ExecutionEnvironmentsList hideOrgColumn={false} />
    </PageLayout>
  );
}
