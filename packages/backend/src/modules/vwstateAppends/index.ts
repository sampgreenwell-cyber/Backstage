import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { DefaultGithubCredentialsProvider, ScmIntegrations } from '@backstage/integration';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createApplyAppendsAction } from './action';
import { createCheckProductAction } from './checkProduct';

/** Scaffolder actions for the Gemini Uprise service template: vwstate:check-product and vwstate:apply-appends. */
export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'vwstate-appends',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        reader: coreServices.urlReader,
        config: coreServices.rootConfig,
      },
      async init({ scaffolder, reader, config }) {
        const integrations = ScmIntegrations.fromConfig(config);
        const githubCredentials = DefaultGithubCredentialsProvider.fromIntegrations(integrations);
        scaffolder.addActions(
          createCheckProductAction({ reader, integrations, githubCredentials }),
          createApplyAppendsAction({ reader }),
        );
      },
    });
  },
});
