import { githubAuthApiRef } from '@backstage/core-plugin-api';
import { SignInPage as SignInPageComponent } from '@backstage/core-components';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';

// Overrides the default sign-in page, which offers only the guest
// provider - fine for local dev, but a real problem in production: guest
// auth is intentionally disabled there (see app-config.production.yaml),
// and without this override the app has no other way to let anyone sign
// in at all, GitHub included.
export const SignInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => props => (
      <SignInPageComponent
        {...props}
        provider={{
          id: 'github-auth-provider',
          title: 'GitHub',
          message: 'Sign in using GitHub',
          apiRef: githubAuthApiRef,
        }}
      />
    ),
  },
});
