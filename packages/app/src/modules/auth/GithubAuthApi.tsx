import { ApiBlueprint } from '@backstage/frontend-plugin-api';
import {
  configApiRef,
  discoveryApiRef,
  githubAuthApiRef,
  oauthRequestApiRef,
} from '@backstage/core-plugin-api';
import { GithubAuth } from '@backstage/core-app-api';

// Overrides the app's default githubAuthApiRef (which only ever requests
// `read:user`, just enough to sign in) so the session established at
// sign-in already carries the `repo`/`read:org` scopes ScmAuth needs for
// the GitHub Actions widget and "Register Existing Component". Sign-in
// uses `instantPopup`, which opens the GitHub consent window directly from
// the "Sign in" button click - a real user gesture browsers never block.
// Requesting the scopes there means later plugin calls never need to
// silently upgrade the session's scope after the fact, which requires a
// second popup that isn't tied to any click and so gets blocked, leaving
// those calls stuck with the narrower read:user token (and GitHub 404s
// instead of showing real data, since it hides repos an unauthorized
// caller can't see rather than returning 401/403).
export const githubAuthApi = ApiBlueprint.make({
  params: define =>
    define({
      api: githubAuthApiRef,
      deps: {
        configApi: configApiRef,
        discoveryApi: discoveryApiRef,
        oauthRequestApi: oauthRequestApiRef,
      },
      factory: ({ configApi, discoveryApi, oauthRequestApi }) =>
        GithubAuth.create({
          configApi,
          discoveryApi,
          oauthRequestApi,
          defaultScopes: ['repo', 'read:org', 'read:user'],
          environment: configApi.getOptionalString('auth.environment'),
        }),
    }),
});
