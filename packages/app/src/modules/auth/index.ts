import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPage } from './SignInPage';
import { scmAuthApi } from './ScmAuthApi';
import { oAuthRequestDialogElement } from './OAuthRequestDialogElement';

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [SignInPage, scmAuthApi, oAuthRequestDialogElement],
});
