import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPage } from './SignInPage';
import { oAuthRequestDialogElement } from './OAuthRequestDialogElement';

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [SignInPage, oAuthRequestDialogElement],
});
