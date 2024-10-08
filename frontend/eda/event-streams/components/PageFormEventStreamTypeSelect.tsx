import { FieldPath, FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PageFormSingleSelectEdaResource } from '../../common/PageFormSingleSelectEdaResource';

import { useCredentialTypesColumns } from '../../access/credential-types/hooks/useCredentialTypesColumns';
import { useCredentialTypeFilters } from '../../access/credential-types/hooks/useCredentialTypeFilters';
import { EdaCredentialType } from '../../interfaces/EdaCredentialType';
import { edaAPI } from '../../common/eda-utils';

/**
 * A form input for selecting an eventStreamType.
 *
 * @example
 * ```tsx
 * <PageFormSelectEventStreamType<Credential> name="eventStreamType" />
 * ```
 */
export function PageFormSelectEventStreamType<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: { name: TFieldName; isRequired?: boolean; isDisabled?: string; helperText?: string }) {
  const { t } = useTranslation();
  const eventStreamTypeColumns = useCredentialTypesColumns();
  const eventStreamTypeFilters = useCredentialTypeFilters();
  return (
    <PageFormSingleSelectEdaResource<EdaCredentialType, TFieldValues, TFieldName>
      name={props.name}
      id="webhook_type_id"
      label={t('Event stream type')}
      placeholder={t('Select event stream type')}
      queryPlaceholder={t('Loading event stream types...')}
      queryErrorText={t('Error loading event stream types')}
      isRequired={props.isRequired}
      isDisabled={props.isDisabled}
      helperText={props.helperText}
      url={edaAPI`/credential-types/`}
      queryParams={{ namespace: 'event_stream' }}
      tableColumns={eventStreamTypeColumns}
      toolbarFilters={eventStreamTypeFilters}
    />
  );
}
