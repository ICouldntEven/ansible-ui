/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { randomLowercaseString, randomString } from '../../framework/utils/random-string';
import { Role } from '../../frontend/hub/access/roles/Role';
import { RemoteRegistry } from '../../frontend/hub/administration/remote-registries/RemoteRegistry';
import { HubRemote } from '../../frontend/hub/administration/remotes/Remotes';
import { Repository } from '../../frontend/hub/administration/repositories/Repository';
import { Task } from '../../frontend/hub/administration/tasks/Task';
import { CollectionVersionSearch } from '../../frontend/hub/collections/Collection';
import { parsePulpIDFromURL } from '../../frontend/hub/common/api/hub-api-utils';
import { HubItemsResponse, PulpItemsResponse } from '../../frontend/hub/common/useHubView';
import { ExecutionEnvironment as HubExecutionEnvironment } from '../../frontend/hub/execution-environments/ExecutionEnvironment';
import { PayloadDataType as HubExecutionEnvironmentPayload } from '../../frontend/hub/execution-environments/ExecutionEnvironmentForm';
import { HubDistribution } from '../../frontend/hub/interfaces/expanded/HubDistribution';
import { HubNamespace } from '../../frontend/hub/namespaces/HubNamespace';
import { ExecutionEnvironments } from '../e2e/hub/constants';
import { galaxykitPassword, galaxykitUsername } from './e2e';
import { hubAPI, pulpAPI } from './formatApiPathForHub';
import { escapeForShellCommand, randomE2Ename } from './utils';
import { SetRequired } from 'type-fest';
import { ContentTypeEnum } from '../../frontend/hub/interfaces/expanded/ContentType';
import { HubRbacRole } from '../../frontend/hub/interfaces/expanded/HubRbacRole';

const apiPrefix = Cypress.env('HUB_API_PREFIX') as string;

export interface HubRequestOptions {
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  url: string;
  body?: object;
  qs?: object;
  failOnStatusCode?: boolean;
  headers?: object;
}
Cypress.Commands.add('hubRequest', (options: HubRequestOptions) => {
  cy.getCookie('csrftoken', { log: false }).then((cookie) =>
    cy
      .request({
        ...options,
        headers: {
          ...(options.headers || {}),
          'X-CSRFToken': cookie?.value,
          Referer: Cypress.config().baseUrl,
        },
      })
      .then((response) => {
        switch (response.status) {
          case 201:
            return cy.wrap(response.body);
          case 202: {
            // Accepted
            // when posting as multipart/form-data, the response doesn't get parsed as JSON
            const body =
              response.body.toString() === '[object ArrayBuffer]'
                ? (JSON.parse(new TextDecoder().decode(response.body as ArrayBuffer)) as object)
                : (response.body as object);
            return cy.waitOnHubTask((body as { task: string }).task);
          }
        }
      })
  );
});

export type HubGetRequestOptions = Pick<HubRequestOptions, 'url' | 'qs' | 'failOnStatusCode'>;
Cypress.Commands.add('hubGetRequest', (options: HubGetRequestOptions) => {
  cy.hubRequest({ ...options, method: 'GET' });
});

export type HubPostRequestOptions = Pick<
  HubRequestOptions,
  'url' | 'body' | 'qs' | 'failOnStatusCode' | 'headers'
>;
Cypress.Commands.add('hubPostRequest', (options: HubPostRequestOptions) => {
  cy.hubRequest({ ...options, method: 'POST' });
});

export type HubDeleteRequestOptions = Pick<HubRequestOptions, 'url' | 'qs' | 'failOnStatusCode'>;
Cypress.Commands.add('hubDeleteRequest', (options: HubDeleteRequestOptions) => {
  cy.hubRequest({ ...options, method: 'DELETE' });
});

Cypress.Commands.add('waitOnHubTask', function waitOnHubTask(taskUrl: string) {
  cy.requestPoll<Task>({
    url: taskUrl,
    check: (response) => {
      switch (response.status) {
        case 200:
          switch (response.body.state) {
            case 'completed':
              return response.body;
            case 'failed':
            case 'canceled':
            case 'skipped':
              if (response.body.error?.description) {
                throw new Error(response.body.error.description);
              } else {
                throw new Error('Task failed without error message.');
              }
            default:
              return undefined;
          }
        case 404:
          throw new Error('Task not found');
        default:
          return undefined;
      }
    },
  });
});

Cypress.Commands.add('waitForAllTasks', function waitForAllTasks() {
  function waitForAllTasks(count: number) {
    if (count === 0) {
      throw new Error('Max loops reached while waiting for the tasks.');
    }
    cy.wait(1000);
    cy.requestGet<PulpItemsResponse<Task>>(pulpAPI`/tasks/?state__in=waiting,running`).then(
      (response) => {
        const tasks = response.results;
        cy.log(`Tasks count: ${tasks.length}`);
        if (tasks.length === 0) {
          return;
        } else {
          waitForAllTasks(count - 1);
        }
      }
    );
  }

  waitForAllTasks(100);
});

// GalaxyKit Integration: To invoke `galaxykit` commands for generating resource
Cypress.Commands.add('galaxykit', (operation: string, ...args: string[]) => {
  const galaxykitCommand = (Cypress.env('HUB_GALAXYKIT_COMMAND') as string) ?? 'galaxykit';
  const platformServer = (Cypress.env('PLATFORM_SERVER') as string) || '';
  const upstreamServer = Cypress.env('HUB_SERVER') as string;
  const apiBase = (platformServer || upstreamServer) + apiPrefix;
  const options = { failOnNonZeroExit: false };

  operation = operation.trim();
  args = args.map((arg) => arg.trim());

  cy.log(`${galaxykitCommand} ${operation} ${args.join(' ')}`);

  const gwRoot = platformServer ? `--gw_root_url '${platformServer}/'` : '';
  const cmd = `${galaxykitCommand} -c -s '${apiBase}/' -u '${galaxykitUsername}' -p '${galaxykitPassword}' ${gwRoot} ${operation} ${escapeForShellCommand(
    args
  )}`;

  cy.exec(cmd, options).then(({ code, stderr, stdout }) => {
    cy.log(`RUN ${cmd}`, code, stderr, stdout).then(() => {
      if (code) {
        cy.log('galaxykit code: ' + code.toString()).then(() => {
          cy.log('galaxykit stderr: ' + stderr).then(() => {
            throw new Error(`Galaxykit failed: ${stderr}`);
          });
        });
      }
    });

    cy.log(`stdout: ${stdout}`);

    let parsedStdout: unknown;
    try {
      parsedStdout = JSON.parse(stdout);
    } catch (e) {
      parsedStdout = stdout.split('\n').filter((s) => !!s);
    }
    return cy.wrap(parsedStdout);
  });
});

Cypress.Commands.add(
  'createApprovedCollection',
  (namespaceName: string, collectionName: string, tags?: string[]) => {
    const waitTillPublished = (maxLoops: number) => {
      if (maxLoops === 0) {
        cy.log('Max loops reached while waiting for the approved collection.');
        return;
      }

      cy.wait(300);

      cy.requestGet<HubItemsResponse<CollectionVersionSearch>>(
        hubAPI`/v3/plugin/ansible/search/collection-versions/?namespace=${namespaceName}&name=${collectionName}`
      ).then((itemsResponse) => {
        if (itemsResponse.data.length === 0) {
          waitTillPublished(maxLoops - 1);
        } else if (itemsResponse.data[0]?.repository?.name !== 'published') {
          waitTillPublished(maxLoops - 1);
        } else {
          cy.log('Collection published');
        }
      });
    };

    if (tags?.length) {
      cy.galaxykit(
        '-i collection upload',
        namespaceName,
        collectionName,
        `--tags ${tags.join(' ')}`
      );
      cy.waitForAllTasks();
    } else {
      cy.galaxykit('-i collection upload', namespaceName, collectionName);
      cy.waitForAllTasks();
    }

    waitTillPublished(10);

    // TODO for Insights mode
    // if (insightsLogin) {
    //   cy.galaxykit('-i collection move', namespace, collection);
    // }
  }
);

Cypress.Commands.add('uploadHubCollectionFile', (hubFilePath: string) => {
  cy.get('[data-cy="upload-collection"]').click();
  cy.get('#file-browse-button').click();
  cy.get('input[id="file-filename"]').selectFile(hubFilePath, {
    action: 'drag-drop',
  });
});

Cypress.Commands.add('deleteCollectionsInNamespace', (namespaceName: string) => {
  cy.requestGet<HubItemsResponse<CollectionVersionSearch>>(
    hubAPI`/v3/plugin/ansible/search/collection-versions/?namespace=${namespaceName}`
  ).then((itemsResponse) => {
    cy.log(`count of collections in namespace: ${itemsResponse.data.length}`);
    for (const collection of itemsResponse.data) {
      cy.deleteHubCollection(collection);
      cy.waitForAllTasks();
    }
  });
});

Cypress.Commands.add(
  'createRemote',
  (
    remoteName: string,
    url?: string,
    ca_cert?: string,
    client_cert?: string,
    requirements_file?: string
  ) => {
    const payload: {
      name: string;
      url: string;
      ca_cert?: string;
      client_cert?: string;
      requirements_file?: string;
    } = {
      name: remoteName,
      url: url ? url : 'https://console.redhat.com/api/automation-hub/',
    };
    if (ca_cert) {
      payload.ca_cert = ca_cert;
    }
    if (client_cert) {
      payload.client_cert = client_cert;
    }
    if (requirements_file) {
      payload.requirements_file = requirements_file;
    }
    cy.requestPost(pulpAPI`/remotes/ansible/collection/`, payload);
  }
);

Cypress.Commands.add('createRemoteRegistry', (remoteRegistryName: string, url?: string) => {
  cy.requestPost(hubAPI`/_ui/v1/execution-environments/registries/`, {
    name: remoteRegistryName,
    url: url ? url : 'https://console.redhat.com/api/automation-hub/',
  });
});

Cypress.Commands.add('deleteRemoteRegistry', (remoteRegistryId: string) => {
  cy.requestDelete(hubAPI`/_ui/v1/execution-environments/registries/${remoteRegistryId}/`);
  cy.waitForAllTasks();
});

Cypress.Commands.add(
  'deleteCollection',
  (
    collectionName: string,
    namespaceName: string,
    repository: string,
    version?: string,
    options?: {
      /** Whether to fail on response codes other than 2xx and 3xx */
      failOnStatusCode?: boolean;
    }
  ) => {
    const fail = options?.failOnStatusCode ? '' : '-i';
    const versionToDelete = version ? version : '1.0.0';
    cy.galaxykit(
      fail + ' collection delete',
      namespaceName,
      collectionName,
      versionToDelete,
      repository
    );
    cy.waitForAllTasks();
  }
);

Cypress.Commands.add(
  'uploadCollection',
  (collection: string, namespace: string, version: string, repository?: string) => {
    cy.galaxykit(
      'collection upload --skip-upload',
      namespace,
      collection,
      version ? version : '1.0.0'
    ).then((result) => {
      const filePath = (result as unknown as Record<string, string>).filename;
      cy.readFile(filePath, 'binary').then((fileData: string) => {
        const formData = new FormData();
        formData.append('file', Cypress.Blob.binaryStringToBlob(fileData), filePath);

        cy.hubPostRequest({
          url: hubAPI`/v3/plugin/ansible/content/${repository || 'validated'}/collections/artifacts/`,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          body: formData,
        });
      });
    });
    cy.waitForAllTasks();
  }
);

Cypress.Commands.add(
  'approveCollection',
  (collection: string, namespace: string, version: string) => {
    cy.galaxykit('collection move', namespace, collection, version, 'staging', 'published');
    cy.waitForAllTasks();
  }
);

Cypress.Commands.add(
  'moveCollection',
  (
    collection: string,
    namespace: string,
    version: string,
    sourceRepo: string,
    targetRepo: string
  ) => {
    cy.waitForAllTasks();
    cy.galaxykit('collection move', namespace, collection, version, sourceRepo, targetRepo);
    cy.waitForAllTasks();
  }
);

Cypress.Commands.add('collectionCopyVersionToRepositories', (collectionName: string) => {
  cy.get('[data-ouia-component-type="PF5/ModalContent"]').within(() => {
    cy.get('header').contains('Select repositories');
    cy.get('button').contains('Select').should('have.attr', 'aria-disabled', 'true');
    cy.filterTableBySingleText('community');
    cy.get('[data-cy="data-list-check"]').click();
    cy.get('button').contains('Select').click();
  });

  cy.navigateTo('hub', 'approvals');
  cy.clickButton(/^Clear all filters$/);

  cy.filterTableBySingleText(collectionName);
  cy.get('[aria-label="Simple table"] tr').should('have.length', 3);
  cy.contains('No results found').should('not.exist');
});

// HUB Execution Environment Commands
export type HubQueryExecutionEnvironmentsOptions = { qs?: { limit?: number } } & Omit<
  HubGetRequestOptions,
  'url'
>;
export type HubCreateExecutionEnvironmentOptions = {
  executionEnvironment: SetRequired<Partial<HubExecutionEnvironmentPayload>, 'registry'>;
} & Omit<HubPostRequestOptions, 'url' | 'body'>;

Cypress.Commands.add(
  'createHubExecutionEnvironment',
  (options: HubCreateExecutionEnvironmentOptions) => {
    cy.hubPostRequest({
      ...options,
      url: hubAPI`/_ui/v1/execution-environments/remotes/`,
      body: {
        name: randomE2Ename(),
        upstream_name: 'pulp/pulp-fixtures',
        include_tags: ['latest'],
        ...options?.executionEnvironment,
      },
    });
  }
);

export type HubDeleteExecutionEnvironmentOptions = { name: string } & Omit<
  HubDeleteRequestOptions,
  'url'
>;

Cypress.Commands.add(
  'deleteHubExecutionEnvironment',
  (options: HubDeleteExecutionEnvironmentOptions) => {
    cy.hubDeleteRequest({
      ...options,
      url: hubAPI`/v3/plugin/execution-environments/repositories/${options.name}/`,
    });
  }
);

Cypress.Commands.add(
  'syncRemoteExecutionEnvironment',
  (executionEnvironment: HubExecutionEnvironment) => {
    cy.navigateTo('hub', ExecutionEnvironments.url);
    cy.verifyPageTitle('Execution Environments');
    cy.filterTableBySingleText(executionEnvironment.name);
    cy.get('a').contains(executionEnvironment.name).click();
    cy.verifyPageTitle(executionEnvironment.name);

    cy.getByDataCy('actions-dropdown').click();
    cy.getByDataCy('sync-execution-environment').click();

    cy.clickModalConfirmCheckbox();
    cy.intercept(
      'POST',
      hubAPI`/v3/plugin/execution-environments/repositories/${executionEnvironment.name}/_content/sync/`
    ).as('eeSync');
    cy.clickButton('Sync execution environments');
    cy.wait('@eeSync').then((xhr) => {
      const task = xhr?.response?.body?.task as string;
      cy.waitOnHubTask(task).then((currentSubject: unknown) => {
        const task = currentSubject as Task;
        expect(task.state).to.be.eql('completed');
        cy.contains('Success');
        cy.clickButton('Close');
      });
    });
  }
);

// HUB Remote Registry Commands
export type HubCreateRemoteRegistryOptions = {
  remoteRegistry: Partial<RemoteRegistry>;
} & Omit<HubPostRequestOptions, 'url' | 'body'>;

Cypress.Commands.add('createHubRemoteRegistry', (options?: HubCreateRemoteRegistryOptions) => {
  cy.hubPostRequest({
    ...options,
    url: hubAPI`/_ui/v1/execution-environments/registries/`,
    body: {
      name: randomE2Ename(),
      url: 'https://quay.io/',
      ...options?.remoteRegistry,
    },
  });
});

export type HubDeleteRemoteRegistryOptions = { id: string } & Omit<HubDeleteRequestOptions, 'url'>;

Cypress.Commands.add('deleteHubRemoteRegistry', (options: HubDeleteRemoteRegistryOptions) => {
  cy.hubDeleteRequest({
    ...options,
    url: hubAPI`/_ui/v1/execution-environments/registries/${options.id}/`,
  });
});

// HUB Repository Commands
export type HubQueryRepositoriesOptions = { qs?: { limit?: number } } & Omit<
  HubGetRequestOptions,
  'url'
>;
Cypress.Commands.add('queryHubRepositories', (options?: HubQueryRepositoriesOptions) => {
  cy.hubGetRequest({
    ...options,
    url: pulpAPI`/repositories/ansible/ansible/`,
  });
});
export type HubCreateRepositoryOptions = {
  repository: Partial<Repository>;
} & Omit<HubPostRequestOptions, 'url' | 'body'>;

Cypress.Commands.add('createHubRepository', (options?: HubCreateRepositoryOptions) => {
  cy.hubPostRequest({
    ...options,
    url: pulpAPI`/repositories/ansible/ansible/`,
    body: {
      description: null,
      name: randomE2Ename(),
      private: false,
      pulp_labels: {},
      remote: null,
      retain_repo_versions: 1,
      ...options?.repository,
    },
  });
});

export type HubDeleteRepositoryOptions = { pulp_href: string } & Omit<
  HubDeleteRequestOptions,
  'url'
>;

Cypress.Commands.add('deleteHubRepository', (options: HubDeleteRepositoryOptions) => {
  const pulpUUID = parsePulpIDFromURL(options.pulp_href);
  cy.hubDeleteRequest({
    ...options,
    url: pulpAPI`/repositories/ansible/ansible/${pulpUUID ?? ''}/`,
  });
});

// HUB Repository Distribution Commands
export type HubCreateRepositoryDistributionOptions = {
  distribution: Partial<HubDistribution>;
} & Omit<HubPostRequestOptions, 'url' | 'body'>;
Cypress.Commands.add(
  'createHubRepositoryDistribution',
  (options?: HubCreateRepositoryDistributionOptions) => {
    cy.hubPostRequest({
      ...options,
      url: pulpAPI`/distributions/ansible/ansible/`,
      body: {
        name: randomE2Ename(),
        base_path: randomLowercaseString(32),
        ...options?.distribution,
      },
    });
  }
);
export type HubDeleteRepositoryDistributionOptions = { pulp_href: string } & Omit<
  HubDeleteRequestOptions,
  'url'
>;
Cypress.Commands.add(
  'deleteHubRepositoryDistributionByName',
  (name: string, options?: Omit<HubDeleteRequestOptions, 'url'>) => {
    cy.hubGetRequest<PulpItemsResponse<{ pulp_href: string }>>({
      url: pulpAPI`/distributions/ansible/ansible/?name=${name}`,
    }).then((response) => {
      cy.hubDeleteRequest({ ...options, url: response.body.results[0].pulp_href });
    });
  }
);

// HUB Namespace Commands
export type HubQueryNamespacesOptions = { qs?: { limit?: number } } & Omit<
  HubGetRequestOptions,
  'url'
>;
export type HubCreateNamespaceOptions = { namespace: Partial<HubNamespace> } & Omit<
  HubPostRequestOptions,
  'url' | 'body'
>;

Cypress.Commands.add('createHubNamespace', (options?: HubCreateNamespaceOptions) => {
  cy.hubPostRequest({
    ...options,
    url: hubAPI`/_ui/v1/namespaces/`,
    body: { name: randomE2Ename(), ...options?.namespace },
  });
});

export type HubDeleteNamespaceOptions = { name: string } & Omit<HubDeleteRequestOptions, 'url'>;

Cypress.Commands.add('deleteHubNamespace', (options: HubDeleteNamespaceOptions) => {
  cy.waitForAllTasks();
  cy.deleteCollectionsInNamespace(options.name);
  cy.waitForAllTasks();
  cy.hubDeleteRequest({
    ...options,
    url: hubAPI`/_ui/v1/namespaces/${options.name}/`,
  });
});

// HUB Role Commands
export type HubQueryRolesOptions = { qs?: { limit?: number } } & Omit<HubGetRequestOptions, 'url'>;
Cypress.Commands.add('queryHubRoles', (options?: HubQueryRolesOptions) => {
  cy.hubGetRequest({
    ...options,
    url: pulpAPI`/roles/`,
  });
});
export type HubCreateRoleOptions = { role: Partial<Role> } & Omit<
  HubPostRequestOptions,
  'url' | 'body'
>;

Cypress.Commands.add('createHubRole', (options?: HubCreateRoleOptions) => {
  cy.hubPostRequest({
    ...options,
    url: pulpAPI`/roles/`,
    body: {
      name: `galaxy.e2erole${randomString(4)}`,
      description: 'E2E custom role description',
      permissions: ['galaxy.add_namespace', 'container.namespace_change_containerdistribution'],
      ...options?.role,
    },
  });
});

export type HubDeleteRoleOptions = { pulp_href: string } & Omit<HubDeleteRequestOptions, 'url'>;

Cypress.Commands.add('deleteHubRole', (options: HubDeleteRoleOptions) => {
  const pulpUUID = parsePulpIDFromURL(options.pulp_href);
  cy.hubDeleteRequest({
    ...options,
    url: pulpAPI`/roles/${pulpUUID ?? ''}/`,
  });
});

// HUB Remote Commands
export type HubQueryRemotesOptions = { qs?: { limit?: number } } & Omit<
  HubGetRequestOptions,
  'url'
>;
Cypress.Commands.add('queryHubRemotes', (options?: HubQueryRemotesOptions) => {
  cy.hubGetRequest({
    ...options,
    url: pulpAPI`/remotes/ansible/collection/`,
  });
});
export type HubCreateRemoteOptions = { remote: Partial<HubRemote> } & Omit<
  HubPostRequestOptions,
  'url' | 'body'
>;

Cypress.Commands.add('createHubRemote', (options?: HubCreateRemoteOptions) => {
  cy.hubPostRequest({
    ...options,
    url: pulpAPI`/remotes/ansible/collection/`,
    body: {
      name: randomE2Ename(),
      url: 'https://console.redhat.com/api/automation-hub/',
      ...options?.remote,
    },
  });
});

export type HubDeleteRemoteOptions = { pulp_href: string } & Omit<HubDeleteRequestOptions, 'url'>;

Cypress.Commands.add('deleteHubRemote', (options: HubDeleteRemoteOptions) => {
  const pulpUUID = parsePulpIDFromURL(options.pulp_href);
  cy.hubDeleteRequest({
    ...options,
    url: pulpAPI`/remotes/ansible/collection/${pulpUUID ?? ''}/`,
  });
});

// HUB Collection Commands
Cypress.Commands.add('getHubCollection', (name: string) => {
  return cy
    .requestGet<
      HubItemsResponse<CollectionVersionSearch>
    >(hubAPI`/v3/plugin/ansible/search/collection-versions/?name=${name}`)
    .then((itemsResponse) => itemsResponse.data[0]);
});

export type HubDeleteCollectionOptions = {
  repository?: { name: string };
  collection_version?: { name: string; namespace: string };
} & Omit<HubDeleteRequestOptions, 'url'>;

Cypress.Commands.add('deleteHubCollection', (options: HubDeleteCollectionOptions) => {
  cy.hubDeleteRequest({
    ...options,
    url: hubAPI`/v3/plugin/ansible/content/${
      options.repository?.name ?? 'community'
    }/collections/index/${options.collection_version?.namespace ?? ''}/${
      options.collection_version?.name ?? ''
    }/`,
  });
});

Cypress.Commands.add('deleteHubCollectionByName', (name: string) => {
  cy.requestGet<HubItemsResponse<CollectionVersionSearch>>(
    hubAPI`/v3/plugin/ansible/search/collection-versions/?name=${name}`
  ).then((itemsResponse) => {
    //itemsResponse is an array that can return more than one item with the same name
    //the following code is written to prevent multiple DELETE requests of a collection
    //with the same name. Without this code, the DELETE request would be made twice
    //on the same collection, resulting in an API error
    for (const collection of itemsResponse.data) {
      const repeatedName = itemsResponse.data[0]?.collection_version?.name;
      if (collection?.collection_version?.name === repeatedName) {
        cy.deleteHubCollection(collection);
        cy.waitForAllTasks();
        break;
      } else {
        cy.deleteHubCollection(collection);
        cy.waitForAllTasks();
      }
    }
  });
});

Cypress.Commands.add(
  'getHubRoles',
  (queryParams?: { content_type__model?: string; managed?: boolean }) => {
    let roleDefinitionsUrl = hubAPI`/_ui/v2/role_definitions/?order_by=name`;
    if (queryParams) {
      const { content_type__model, managed } = queryParams;
      roleDefinitionsUrl = content_type__model
        ? (roleDefinitionsUrl += `&content_type__model=${content_type__model}`)
        : roleDefinitionsUrl;
      roleDefinitionsUrl =
        managed !== undefined ? (roleDefinitionsUrl += `&managed=${managed}`) : roleDefinitionsUrl;
    }

    cy.requestGet<HubItemsResponse<HubRbacRole>>(roleDefinitionsUrl).then((response) => {
      return response;
    });
  }
);

Cypress.Commands.add('getHubRoleDetail', (roleID: string) => {
  cy.requestGet<HubRbacRole>(hubAPI`/_ui/v2/role_definitions/${roleID}/`);
});

Cypress.Commands.add(
  'createHubRoleAPI',
  ({
    roleName,
    description,
    content_type,
    permissions,
  }: {
    roleName: string;
    description: string;
    content_type: ContentTypeEnum;
    permissions: string[];
  }) => {
    cy.requestPost<HubRbacRole>(hubAPI`/_ui/v2/role_definitions/`, {
      name: roleName,
      description: description,
      content_type: content_type,
      permissions: permissions,
    }).then(() => {
      Cypress.log({
        displayName: 'Hub Role :',
      });
    });
  }
);

Cypress.Commands.add('deleteHubRoleAPI', (hubRoleDefinition: HubRbacRole) => {
  cy.requestDelete(hubAPI`/_ui/v2/role_definitions/${hubRoleDefinition.id.toString()}/`, {
    failOnStatusCode: false,
  }).then(() => {
    Cypress.log({
      displayName: 'HUB ROLE DELETION :',
      message: [`Deleted 👉  ${hubRoleDefinition.name}`],
    });
  });
});
