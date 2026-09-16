import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPage } from './SignInPage';
import { oAuthRequestDialogElement } from './OAuthRequestDialogElement';
import { githubAuthApi } from './GithubAuthApi';

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [SignInPage, oAuthRequestDialogElement, githubAuthApi],
});
