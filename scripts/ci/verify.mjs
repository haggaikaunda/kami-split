// Missing/malformed applicability can never authorize a skipped branch.
export function validResult(required, result) {
  return required === 'true'
    ? result === 'success'
    : required === 'false' && result === 'skipped';
}
export function verify({
  classification,
  repository,
  webRequired,
  apiRequired,
  web,
  api,
}) {
  return (
    classification === 'success' &&
    repository === 'success' &&
    validResult(webRequired, web) &&
    validResult(apiRequired, api)
  );
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const e = process.env;
  if (
    !verify({
      classification: e.CLASSIFICATION_RESULT,
      repository: e.REPOSITORY_RESULT,
      webRequired: e.WEB_REQUIRED,
      apiRequired: e.API_REQUIRED,
      web: e.WEB_RESULT,
      api: e.API_RESULT,
    })
  ) {
    console.error(
      'Required verification failed, was cancelled, or was unexpectedly skipped.',
    );
    process.exitCode = 1;
  }
}
