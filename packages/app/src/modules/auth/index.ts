import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPage } from './SignInPage';

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [SignInPage],
});
