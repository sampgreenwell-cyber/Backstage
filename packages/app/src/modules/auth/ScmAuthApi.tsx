import { ApiBlueprint } from '@backstage/frontend-plugin-api';
import { githubAuthApiRef } from '@backstage/core-plugin-api';
import { ScmAuth, scmAuthApiRef } from '@backstage/integration-react';

// Wires up scmAuthApiRef for GitHub so plugins that talk to the GitHub REST
// API from the browser (github-actions, catalog-import, etc.) get a real
// OAuth token with the scopes they ask for (e.g. `repo`), instead of no
// token at all. Without this, calls for private repos come back 404 - GitHub
// hides private repos from unauthenticated requests rather than returning
// 401/403 - even though the user is signed in to Backstage itself.
export const scmAuthApi = ApiBlueprint.make({
  params: define =>
    define({
      api: scmAuthApiRef,
      deps: { githubAuthApi: githubAuthApiRef },
      factory: ({ githubAuthApi }) => ScmAuth.forGithub(githubAuthApi),
    }),
});
