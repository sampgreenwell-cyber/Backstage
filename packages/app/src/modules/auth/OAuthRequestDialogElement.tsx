import { AppRootElementBlueprint } from '@backstage/frontend-plugin-api';
import { OAuthRequestDialog } from '@backstage/core-components';

// Mounts the dialog that lets a signed-in user grant additional OAuth scopes
// on demand (e.g. the `repo` scope ScmAuth requests for the GitHub Actions
// widget, beyond the minimal scope used at sign-in). Without this mounted
// somewhere in the app, a scope-escalation request just hangs forever with
// no UI - the popup only ever opens from a click on this dialog, since
// browsers block popups that aren't opened directly from a user gesture.
export const oAuthRequestDialogElement = AppRootElementBlueprint.make({
  name: 'oauth-request-dialog',
  params: {
    element: <OAuthRequestDialog />,
  },
});
